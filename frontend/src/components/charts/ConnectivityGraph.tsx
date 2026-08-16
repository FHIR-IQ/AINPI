'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

import type { ConnectivityGraph as GraphPayload } from '@/lib/connectivity-types';

/**
 * Force-directed view of health system -> endpoint -> EHR vendor.
 *
 * The picture exists to make one thing obvious: which large systems hang
 * unconnected. Systems with no edge drift to the outside as isolated nodes,
 * and that periphery is the finding, not a rendering artefact.
 *
 * Two deliberate choices:
 *
 * - Only the 50 largest systems are drawn. A force layout of 19,535
 *   organizations is a hairball that answers no question.
 * - Connection is encoded by fill and by shape, never by hue alone, so the
 *   distinction survives greyscale and colour-blindness. Same constraint the
 *   treemap ramp is under.
 */

type SimNode = GraphPayload['nodes'][number] & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { kind: string };

const INK = '#171310';
const SIGNAL = '#a8321c';
const PRIMARY = '#08519c';
const MUTED = '#8a8178';

export default function ConnectivityGraph({
  graph,
  height = 560,
}: {
  graph: GraphPayload;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const [hovered, setHovered] = useState<SimNode | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Copy the payload: d3 mutates nodes and links in place, and mutating props
  // makes the layout non-idempotent across re-renders.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as SimNode[],
      links: graph.links.map((l) => ({ ...l })) as unknown as SimLink[],
    }),
    [graph],
  );

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const maxPractitioners =
      d3.max(data.nodes, (n) => n.practitioners ?? 0) || 1;
    const radius = (n: SimNode) =>
      n.type === 'system'
        ? 5 + 16 * Math.sqrt((n.practitioners ?? 0) / maxPractitioners)
        : n.type === 'vendor'
          ? 9
          : 6;

    const simulation = d3
      .forceSimulation(data.nodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(data.links)
          .id((d) => d.id)
          .distance(70)
          .strength(0.6),
      )
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      // Most system nodes have no link at all, which is the point of the
      // chart. Charge alone pushes those straight off the canvas with nothing
      // to pull them back, so a weak positional force holds the unconnected
      // periphery inside the frame where it can be read.
      .force('x', d3.forceX(width / 2).strength(0.06))
      .force('y', d3.forceY(height / 2).strength(0.09))
      .force(
        'collide',
        d3.forceCollide<SimNode>().radius((d) => radius(d) + 5),
      );

    const root = svg.append('g');

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.4, 4])
        .on('zoom', (event) => root.attr('transform', event.transform)),
    );

    const link = root
      .append('g')
      .attr('stroke', MUTED)
      .attr('stroke-opacity', 0.55)
      .selectAll('line')
      .data(data.links)
      .join('line')
      .attr('stroke-width', (d) => (d.kind === 'reaches' ? 1.4 : 0.8))
      .attr('stroke-dasharray', (d) => (d.kind === 'served-by' ? '3 3' : null));

    const node = root
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(data.nodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('mouseenter', (_, d) => setHovered(d))
      .on('mouseleave', () => setHovered(null));

    node.call(
        d3
          .drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    // Vendors are squares, endpoints diamonds, systems circles. Shape carries
    // the type so the chart reads without the legend and without colour.
    node
      .filter((d) => d.type === 'vendor')
      .append('rect')
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', INK)
      .attr('stroke', INK);

    node
      .filter((d) => d.type === 'endpoint')
      .append('rect')
      .attr('x', -6)
      .attr('y', -6)
      .attr('width', 12)
      .attr('height', 12)
      .attr('transform', 'rotate(45)')
      .attr('fill', PRIMARY)
      .attr('stroke', PRIMARY);

    node
      .filter((d) => d.type === 'system')
      .append('circle')
      .attr('r', radius)
      // Filled means connected, hollow with a signal ring means nothing public
      // reaches it. Hollow is the state worth noticing.
      .attr('fill', (d) => (d.connected ? PRIMARY : '#faf8f5'))
      .attr('stroke', (d) => (d.connected ? PRIMARY : SIGNAL))
      .attr('stroke-width', (d) => (d.connected ? 1 : 1.75));

    node
      .filter((d) => d.type === 'system' && (d.practitioners ?? 0) > 1200)
      .append('text')
      .attr('x', 0)
      .attr('y', (d) => radius(d) + 11)
      .attr('text-anchor', 'middle')
      .attr('font-size', 9)
      .attr('fill', INK)
      .text((d) => (d.label ?? '').slice(0, 22));

    simulation.on('tick', () => {
      // Hard clamp as well as the positional forces: a node that still escapes
      // is invisible, and an invisible unconnected system undercounts exactly
      // the thing this chart is for.
      for (const n of data.nodes) {
        const r = radius(n) + 2;
        n.x = Math.max(r, Math.min(width - r, n.x ?? width / 2));
        n.y = Math.max(r, Math.min(height - r - 12, n.y ?? height / 2));
      }
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data, width, height]);

  const unconnected = data.nodes.filter(
    (n) => n.type === 'system' && !n.connected,
  ).length;
  const systems = data.nodes.filter((n) => n.type === 'system').length;

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-700">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill={PRIMARY} />
          </svg>
          System that reaches an endpoint
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <circle
              cx="7"
              cy="7"
              r="5"
              fill="#faf8f5"
              stroke={SIGNAL}
              strokeWidth="1.75"
            />
          </svg>
          Nothing public reaches it ({unconnected} of {systems})
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <rect
              x="3"
              y="3"
              width="8"
              height="8"
              transform="rotate(45 7 7)"
              fill={PRIMARY}
            />
          </svg>
          Endpoint
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <rect x="2" y="2" width="10" height="10" fill={INK} />
          </svg>
          EHR vendor
        </span>
        <span className="text-gray-500">Drag to rearrange, scroll to zoom.</span>
      </div>

      <div className="relative border border-gray-200 bg-white">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={`Force-directed graph of the ${systems} largest health systems, the FHIR endpoints they reach, and the EHR vendors behind those endpoints. ${unconnected} systems reach nothing.`}
        />
        {hovered && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-xs border border-gray-300 bg-paper/95 p-3 text-xs shadow-sm">
            <p className="font-medium text-ink">{hovered.label}</p>
            {hovered.type === 'system' && (
              <p className="mt-1 text-gray-600">
                {(hovered.practitioners ?? 0).toLocaleString('en-US')}{' '}
                practitioners across {hovered.organizations} organizations.
                Grouped by {hovered.basis}.{' '}
                {hovered.connected
                  ? 'Reaches an endpoint.'
                  : 'Nothing public reaches it.'}
              </p>
            )}
            {hovered.type === 'endpoint' && (
              <p className="mt-1 text-gray-600">
                Endpoint host{hovered.vendor ? `, served by ${hovered.vendor}` : ''}.
                {hovered.via ? ` Reached via ${hovered.via}.` : ''}
              </p>
            )}
            {hovered.type === 'vendor' && (
              <p className="mt-1 text-gray-600">EHR vendor.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
