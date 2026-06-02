'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import type { LandscapeCell, LandscapeMetricKey, LandscapeMetricDef } from '@/lib/landscape-types';

export type LandscapeGroupBy = 'specialty' | 'state';

interface LandscapeTreemapProps {
  cells: LandscapeCell[];
  metric: LandscapeMetricDef;
  groupBy: LandscapeGroupBy;
  width?: number;
  height?: number;
  onCellClick?: (cell: LandscapeCell) => void;
  selectedCell?: LandscapeCell | null;
}

interface ChildNode {
  cell: LandscapeCell;
  value: number;
}

interface GroupNode {
  name: string;
  total: number;
  children: ChildNode[];
}

interface RootNode {
  name: 'root';
  children: GroupNode[];
}

function valueForColor(cell: LandscapeCell, key: LandscapeMetricKey, invert: boolean): number {
  const raw = cell.metrics[key];
  if (key === 'currency_days_median') {
    const norm = Math.max(0, Math.min(1, 1 - raw / 365));
    return invert ? norm : 1 - norm;
  }
  return invert ? 1 - raw : raw;
}

function buildHierarchy(cells: LandscapeCell[], groupBy: LandscapeGroupBy): RootNode {
  const groups = new Map<string, GroupNode>();
  for (const cell of cells) {
    if (cell.practitioners <= 0) continue;
    const key = groupBy === 'specialty' ? cell.specialty_display : cell.state_name;
    let g = groups.get(key);
    if (!g) {
      g = { name: key, total: 0, children: [] };
      groups.set(key, g);
    }
    g.children.push({ cell, value: cell.practitioners });
    g.total += cell.practitioners;
  }
  const sorted = Array.from(groups.values())
    .sort((a, b) => b.total - a.total);
  return { name: 'root', children: sorted };
}

export default function LandscapeTreemap({
  cells,
  metric,
  groupBy,
  width = 1200,
  height = 760,
  onCellClick,
  selectedCell,
}: LandscapeTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const colorScale = useMemo(
    () => d3.scaleLinear<string>()
      .domain([0, 0.5, 1])
      .range(['#b91c1c', '#f59e0b', '#15803d'])
      .clamp(true),
    [],
  );

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current || cells.length === 0) return;

    type AnyNode = RootNode | GroupNode | ChildNode;
    const data = buildHierarchy(cells, groupBy);

    const root = d3.hierarchy<AnyNode>(data, (n) => {
      if ('children' in n) return n.children as AnyNode[];
      return undefined;
    })
      .sum((n) => ('value' in n ? (n as ChildNode).value : 0))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<AnyNode>()
      .size([width, height])
      // Outer = space between parent groups; inner = space between child cells;
      // top = breathing room for the parent label band.
      .paddingOuter(4)
      .paddingTop(20)
      .paddingInner(1.5)
      .round(true)(root);

    // Parent group rectangles (depth 1): labeled band at top, plus visible boundary
    const groupNodes = root.descendants().filter((d) => d.depth === 1) as
      d3.HierarchyRectangularNode<AnyNode>[];

    const groupG = svg
      .selectAll('g.group')
      .data(groupNodes)
      .join('g')
      .attr('class', 'group')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

    // Parent boundary rect
    groupG.append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 4)
      .attr('fill', '#f8fafc')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1);

    // Parent label
    groupG.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 60 || h < 30) return;
      const g = d3.select(this);
      const group = d.data as GroupNode;
      const maxChars = Math.floor((w - 10) / 6.5);
      const display = group.name.length > maxChars
        ? group.name.substring(0, Math.max(maxChars - 1, 1)) + '…'
        : group.name;
      g.append('text')
        .attr('x', 6)
        .attr('y', 14)
        .attr('fill', '#0f172a')
        .attr('font-size', w > 200 ? '13px' : '11px')
        .attr('font-weight', '700')
        .attr('pointer-events', 'none')
        .text(display);
      if (w > 130) {
        g.append('text')
          .attr('x', w - 6)
          .attr('y', 14)
          .attr('fill', '#64748b')
          .attr('font-size', '10px')
          .attr('font-weight', '500')
          .attr('text-anchor', 'end')
          .attr('pointer-events', 'none')
          .text(group.total.toLocaleString());
      }
    });

    // Child cells (depth 2): colored, clickable, labeled
    const childNodes = root.leaves() as d3.HierarchyRectangularNode<AnyNode>[];

    const cellG = svg
      .selectAll('g.cell')
      .data(childNodes)
      .join('g')
      .attr('class', 'cell')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

    const isSelected = (d: d3.HierarchyRectangularNode<AnyNode>) => {
      if (!selectedCell) return false;
      const c = (d.data as ChildNode).cell;
      return c.state === selectedCell.state
        && c.specialty_code === selectedCell.specialty_code;
    };

    cellG.append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 1.5)
      .attr('fill', (d) => colorScale(valueForColor((d.data as ChildNode).cell, metric.key, metric.invert)))
      .attr('cursor', onCellClick ? 'pointer' : 'default')
      .attr('stroke', (d) => isSelected(d) ? '#0f172a' : 'rgba(255,255,255,0.55)')
      .attr('stroke-width', (d) => isSelected(d) ? 2.5 : 0.5)
      .attr('opacity', (d) => selectedCell && !isSelected(d) ? 0.5 : 0.96)
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1).attr('stroke-width', isSelected(d) ? 2.5 : 1.5);
        if (tooltipRef.current && svgRef.current) {
          const rect = svgRef.current.getBoundingClientRect();
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = (event.clientX - rect.left + 14) + 'px';
          tooltipRef.current.style.top = (event.clientY - rect.top - 70) + 'px';
          const cell = (d.data as ChildNode).cell;
          tooltipRef.current.innerHTML =
            `<div class="font-semibold">${cell.specialty_display}</div>` +
            `<div class="text-gray-300 text-xs mb-1">${cell.state_name} (${cell.state})</div>` +
            `<div class="text-xs">${cell.practitioners.toLocaleString()} practitioners</div>` +
            `<div class="text-sm mt-1 font-mono">${metric.label}: ${metric.format(cell.metrics[metric.key])}</div>`;
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        if (tooltipRef.current && svgRef.current) {
          const rect = svgRef.current.getBoundingClientRect();
          tooltipRef.current.style.left = (event.clientX - rect.left + 14) + 'px';
          tooltipRef.current.style.top = (event.clientY - rect.top - 70) + 'px';
        }
      })
      .on('mouseout', function (_event, d) {
        d3.select(this)
          .attr('opacity', selectedCell && !isSelected(d) ? 0.5 : 0.96)
          .attr('stroke-width', isSelected(d) ? 2.5 : 0.5);
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .on('click', (_event, d) => {
        if (!onCellClick) return;
        onCellClick((d.data as ChildNode).cell);
      });

    // Child labels — always show short identifier (state code or specialty short),
    // even on small cells. Big cells also get a metric value.
    cellG.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 14 || h < 12) return;
      const g = d3.select(this);
      const cell = (d.data as ChildNode).cell;
      // When grouped by specialty, the cell-defining label is the state code.
      // When grouped by state, it's the specialty (truncated).
      const primary = groupBy === 'specialty'
        ? cell.state
        : cell.specialty_display.split(' ')[0].substring(0, Math.floor((w - 4) / 5));

      g.append('text')
        .attr('x', 3)
        .attr('y', Math.min(11, h - 2))
        .attr('fill', 'white')
        .attr('font-size', w > 40 ? '10px' : '8.5px')
        .attr('font-weight', '700')
        .attr('pointer-events', 'none')
        .attr('style', 'text-shadow: 0 1px 2px rgba(0,0,0,0.45);')
        .text(primary);

      // Metric value on larger cells
      if (w > 56 && h > 28) {
        g.append('text')
          .attr('x', 3)
          .attr('y', h - 4)
          .attr('fill', 'rgba(255,255,255,0.92)')
          .attr('font-size', '9px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
          .attr('pointer-events', 'none')
          .attr('style', 'text-shadow: 0 1px 2px rgba(0,0,0,0.45);')
          .text(metric.format(cell.metrics[metric.key]));
      }
    });
  }, [cells, metric, groupBy, colorScale, width, height, onCellClick, selectedCell]);

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg bg-white border border-gray-200">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
        />
        <div
          ref={tooltipRef}
          className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10 max-w-xs"
          style={{ display: 'none' }}
        />
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-600">
        <span className="font-medium">Worse</span>
        <div className="flex-1 h-2 rounded" style={{ background: 'linear-gradient(to right, #b91c1c, #f59e0b, #15803d)' }} />
        <span className="font-medium">Better</span>
      </div>
    </div>
  );
}
