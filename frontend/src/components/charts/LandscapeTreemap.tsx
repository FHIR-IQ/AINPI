'use client';

import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import type { LandscapeCell, LandscapeMetricKey, LandscapeMetricDef } from '@/lib/landscape-types';

interface LandscapeTreemapProps {
  cells: LandscapeCell[];
  metric: LandscapeMetricDef;
  width?: number;
  height?: number;
  onCellClick?: (cell: LandscapeCell) => void;
  selectedCell?: LandscapeCell | null;
}

function valueForColor(cell: LandscapeCell, key: LandscapeMetricKey, invert: boolean): number {
  const raw = cell.metrics[key];
  if (key === 'currency_days_median') {
    // 0 days = best, 365 days = worst → normalize to [0,1]
    const norm = Math.max(0, Math.min(1, 1 - raw / 365));
    return invert ? norm : 1 - norm;
  }
  return invert ? 1 - raw : raw;
}

export default function LandscapeTreemap({
  cells,
  metric,
  width = 1100,
  height = 620,
  onCellClick,
  selectedCell,
}: LandscapeTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Diverging color scale: red (bad) → amber → green (good). Constant across
  // metrics so users learn the meaning once.
  const colorScale = useMemo(
    () => d3.scaleLinear<string>()
      .domain([0, 0.5, 1])
      .range(['#dc2626', '#f59e0b', '#16a34a'])
      .clamp(true),
    [],
  );

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!svgRef.current || cells.length === 0) return;

    type Datum = { cell: LandscapeCell; value: number };
    const cleaned: Datum[] = cells
      .filter((c) => c.practitioners > 0)
      .map((c) => ({ cell: c, value: c.practitioners }));

    const root = d3.hierarchy<Datum | { children: Datum[] }>({ children: cleaned })
      .sum((d) => ('value' in d ? (d as Datum).value || 0 : 0))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<Datum>()
      .size([width, height])
      .padding(1.5)
      .round(true)(root as unknown as d3.HierarchyNode<Datum>);

    const leaves = root.leaves() as unknown as d3.HierarchyRectangularNode<Datum>[];

    const cellsG = svg
      .selectAll('g.cell')
      .data(leaves)
      .join('g')
      .attr('class', 'cell')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

    const isSelected = (d: d3.HierarchyRectangularNode<Datum>) =>
      !!selectedCell
        && d.data.cell.state === selectedCell.state
        && d.data.cell.specialty_code === selectedCell.specialty_code;

    cellsG.append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 2)
      .attr('fill', (d) => colorScale(valueForColor(d.data.cell, metric.key, metric.invert)))
      .attr('cursor', onCellClick ? 'pointer' : 'default')
      .attr('stroke', (d) => isSelected(d) ? '#0f172a' : 'rgba(255,255,255,0.6)')
      .attr('stroke-width', (d) => isSelected(d) ? 2.5 : 0.5)
      .attr('opacity', (d) => selectedCell && !isSelected(d) ? 0.45 : 0.95)
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1).attr('stroke-width', isSelected(d) ? 2.5 : 1.5);
        if (tooltipRef.current && svgRef.current) {
          const rect = svgRef.current.getBoundingClientRect();
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = (event.clientX - rect.left + 14) + 'px';
          tooltipRef.current.style.top = (event.clientY - rect.top - 60) + 'px';
          const cell = d.data.cell;
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
          tooltipRef.current.style.top = (event.clientY - rect.top - 60) + 'px';
        }
      })
      .on('mouseout', function (_event, d) {
        d3.select(this)
          .attr('opacity', selectedCell && !isSelected(d) ? 0.45 : 0.95)
          .attr('stroke-width', isSelected(d) ? 2.5 : 0.5);
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .on('click', (_event, d) => {
        if (!onCellClick) return;
        onCellClick(d.data.cell);
      });

    // Labels — only on cells big enough to fit them
    cellsG.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 50 || h < 26) return;
      const g = d3.select(this);
      const cell = d.data.cell;

      // State label (big, bold)
      g.append('text')
        .attr('x', 5)
        .attr('y', 14)
        .attr('fill', 'white')
        .attr('font-size', w > 100 ? '11px' : '9.5px')
        .attr('font-weight', '700')
        .attr('pointer-events', 'none')
        .attr('style', 'text-shadow: 0 1px 2px rgba(0,0,0,0.4);')
        .text(cell.state);

      // Specialty truncated to fit
      if (w > 70 && h > 36) {
        const maxChars = Math.floor((w - 10) / 5.5);
        const display = cell.specialty_display.length > maxChars
          ? cell.specialty_display.substring(0, Math.max(maxChars - 1, 1)) + '…'
          : cell.specialty_display;
        g.append('text')
          .attr('x', 5)
          .attr('y', 28)
          .attr('fill', 'rgba(255,255,255,0.92)')
          .attr('font-size', '9.5px')
          .attr('pointer-events', 'none')
          .text(display);
      }

      // Metric value on large cells
      if (w > 80 && h > 56) {
        g.append('text')
          .attr('x', 5)
          .attr('y', h - 6)
          .attr('fill', 'rgba(255,255,255,0.88)')
          .attr('font-size', '10px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
          .attr('pointer-events', 'none')
          .text(metric.format(cell.metrics[metric.key]));
      }
    });
  }, [cells, metric, colorScale, width, height, onCellClick, selectedCell]);

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg bg-slate-50">
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
        <span>Worse</span>
        <div className="flex-1 h-2 rounded" style={{ background: 'linear-gradient(to right, #dc2626, #f59e0b, #16a34a)' }} />
        <span>Better</span>
      </div>
    </div>
  );
}
