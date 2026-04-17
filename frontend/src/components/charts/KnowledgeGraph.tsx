'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

interface GraphNode {
  id: string;
  label: string;
  type: 'organization' | 'practitioner' | 'endpoint' | 'location' | 'practitioner_role';
  size?: number;
}

interface GraphLink {
  source: string;
  target: string;
  relationship: string;
}

interface KnowledgeGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  title: string;
  width?: number;
  height?: number;
}

const TYPE_COLORS: Record<string, string> = {
  organization: '#8b5cf6',
  practitioner: '#3b82f6',
  endpoint: '#10b981',
  location: '#f59e0b',
  practitioner_role: '#ec4899',
};

const TYPE_ICONS: Record<string, string> = {
  organization: 'O',
  practitioner: 'P',
  endpoint: 'E',
  location: 'L',
  practitioner_role: 'R',
};

export default function KnowledgeGraph({
  nodes,
  links,
  title,
  width = 1200,
  height = 700,
}: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Filter nodes and links by selected type
    const activeNodes = selectedType
      ? nodes.filter((n) => n.type === selectedType || links.some((l) =>
          (l.source === n.id || l.target === n.id) &&
          nodes.some((on) => on.id === (l.source === n.id ? l.target : l.source) && on.type === selectedType)
        ))
      : nodes;

    const activeNodeIds = new Set(activeNodes.map((n) => n.id));
    const activeLinks = links.filter((l) => activeNodeIds.has(l.source) && activeNodeIds.has(l.target));

    // Create simulation
    const simulation = d3.forceSimulation(activeNodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(activeLinks as d3.SimulationLinkDatum<d3.SimulationNodeDatum>[])
        .id((d: any) => d.id)
        .distance(80)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-200).distanceMax(300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => Math.max(10, Math.sqrt(d.size || 1) * 3 + 5)))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05));

    // Zoom
    const g = svg.append('g');
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => g.attr('transform', event.transform))
    );

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(activeLinks)
      .join('line')
      .attr('stroke', '#d1d5db')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.4);

    // Link labels (on hover)
    const linkLabels = g.append('g')
      .selectAll('text')
      .data(activeLinks)
      .join('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', '8px')
      .attr('fill', '#9ca3af')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text((d: any) => d.relationship);

    // Nodes
    const node = g.append('g')
      .selectAll('g')
      .data(activeNodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (event: any, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event: any, d: any) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event: any, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        }) as any
      );

    // Node circles
    node.append('circle')
      .attr('r', (d) => Math.max(8, Math.sqrt(d.size || 1) * 2.5 + 4))
      .attr('fill', (d) => TYPE_COLORS[d.type] || '#6b7280')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.9)
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('stroke', '#1e293b').attr('stroke-width', 3).attr('opacity', 1);
        // Highlight connected links
        link.attr('stroke-opacity', (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? 0.8 : 0.1
        ).attr('stroke-width', (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? 2.5 : 0.5
        ).attr('stroke', (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? TYPE_COLORS[d.type] : '#d1d5db'
        );
        linkLabels.attr('opacity', (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? 1 : 0
        );
        showTooltip(event, '<strong>' + d.label + '</strong><br/>' +
          d.type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) +
          (d.size ? '<br/>' + d.size.toLocaleString() + ' connections' : ''));
      })
      .on('mouseout', function () {
        d3.select(this).attr('stroke', '#fff').attr('stroke-width', 2).attr('opacity', 0.9);
        link.attr('stroke-opacity', 0.4).attr('stroke-width', 1).attr('stroke', '#d1d5db');
        linkLabels.attr('opacity', 0);
        hideTooltip();
      });

    // Node letter labels
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', (d) => Math.max(8, Math.sqrt(d.size || 1) * 1.5 + 3) + 'px')
      .attr('font-weight', '700')
      .attr('fill', '#fff')
      .attr('pointer-events', 'none')
      .text((d) => TYPE_ICONS[d.type] || '?');

    // Node name labels (for larger nodes)
    node.filter((d) => (d.size || 0) > 5)
      .append('text')
      .attr('dy', (d) => Math.max(8, Math.sqrt(d.size || 1) * 2.5 + 4) + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#4b5563')
      .attr('pointer-events', 'none')
      .text((d) => d.label.length > 20 ? d.label.substring(0, 18) + '...' : d.label);

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabels
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      node.attr('transform', (d: any) => 'translate(' + d.x + ',' + d.y + ')');
    });

    function showTooltip(event: MouseEvent, html: string) {
      if (!tooltipRef.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      tooltipRef.current.style.display = 'block';
      tooltipRef.current.style.left = (event.clientX - rect.left + 12) + 'px';
      tooltipRef.current.style.top = (event.clientY - rect.top - 40) + 'px';
      tooltipRef.current.innerHTML = html;
    }
    function hideTooltip() {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
    }

    return () => { simulation.stop(); };
  }, [nodes, links, width, height, selectedType]);

  const typeCounts = nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="relative">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">Drag nodes to explore. Scroll to zoom. Hover for details.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedType(null)}
            className={'px-3 py-1 text-xs rounded-full font-medium transition-colors ' +
              (!selectedType ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
          >
            All ({nodes.length})
          </button>
          {Object.entries(typeCounts).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setSelectedType(selectedType === type ? null : type)}
              className={'px-3 py-1 text-xs rounded-full font-medium transition-colors ' +
                (selectedType === type ? 'text-white' : 'text-gray-600 hover:bg-gray-200')}
              style={selectedType === type ? { background: TYPE_COLORS[type] } : { background: '#f3f4f6' }}
            >
              {type.replace('_', ' ')} ({count})
            </button>
          ))}
        </div>
      </div>
      <div className="relative border border-gray-200 rounded-lg overflow-hidden bg-white">
        <svg ref={svgRef} width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} className="w-full h-auto" />
        <div ref={tooltipRef} className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10" style={{ display: 'none' }} />
      </div>
    </div>
  );
}
