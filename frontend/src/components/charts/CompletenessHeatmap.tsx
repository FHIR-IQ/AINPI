'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface HeatmapCell {
  row: string;
  col: string;
  value: number;
}

interface CompletenessHeatmapProps {
  data: HeatmapCell[];
  title: string;
  width?: number;
  height?: number;
}

export default function CompletenessHeatmap({
  data,
  title,
  width = 700,
  height = 300,
}: CompletenessHeatmapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 40, right: 30, bottom: 20, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const rows = [...new Set(data.map((d) => d.row))];
    const cols = [...new Set(data.map((d) => d.col))];

    const x = d3.scaleBand().domain(cols).range([0, innerWidth]).padding(0.06);
    const y = d3.scaleBand().domain(rows).range([0, innerHeight]).padding(0.06);

    const colorScale = d3.scaleSequential()
      .domain([0, 100])
      .interpolator((t: number) => {
        // Red -> Yellow -> Green
        if (t < 0.5) return d3.interpolateRgb('#fee2e2', '#fef3c7')(t * 2);
        return d3.interpolateRgb('#fef3c7', '#d1fae5')((t - 0.5) * 2);
      });

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Cells
    g.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x(d.col)!)
      .attr('y', (d) => y(d.row)!)
      .attr('width', x.bandwidth())
      .attr('height', y.bandwidth())
      .attr('rx', 4)
      .attr('fill', '#f3f4f6')
      .attr('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('stroke', '#1e293b').attr('stroke-width', 2);
        if (tooltipRef.current) {
          const svgRect = svgRef.current!.getBoundingClientRect();
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = `${event.clientX - svgRect.left + 12}px`;
          tooltipRef.current.style.top = `${event.clientY - svgRect.top - 40}px`;
          tooltipRef.current.innerHTML = `
            <strong>${d.row}</strong> — ${d.col}<br/>
            ${d.value.toFixed(1)}% complete
          `;
        }
      })
      .on('mouseout', function () {
        d3.select(this).attr('stroke', 'none');
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .transition()
      .duration(600)
      .delay((_, i) => i * 50)
      .attr('fill', (d) => colorScale(d.value));

    // Cell labels
    g.selectAll('text.cell-label')
      .data(data)
      .join('text')
      .attr('class', 'cell-label')
      .attr('x', (d) => x(d.col)! + x.bandwidth() / 2)
      .attr('y', (d) => y(d.row)! + y.bandwidth() / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '13px')
      .attr('font-weight', '600')
      .attr('fill', (d) => (d.value > 50 ? '#065f46' : '#991b1b'))
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .transition()
      .duration(600)
      .delay((_, i) => i * 50 + 300)
      .attr('opacity', 1)
      .each(function (d) {
        const el = this as SVGTextElement;
        const interp = d3.interpolate(0, d.value);
        d3.select(el)
          .transition()
          .duration(600)
          .tween('text', () => (t: number) => {
            el.textContent = `${interp(t).toFixed(1)}%`;
          });
      });

    // Column headers
    g.selectAll('text.col-header')
      .data(cols)
      .join('text')
      .attr('class', 'col-header')
      .attr('x', (d) => x(d)! + x.bandwidth() / 2)
      .attr('y', -12)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .attr('fill', '#374151')
      .text((d) => d);

    // Row headers
    g.selectAll('text.row-header')
      .data(rows)
      .join('text')
      .attr('class', 'row-header')
      .attr('x', -8)
      .attr('y', (d) => y(d)! + y.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '13px')
      .attr('fill', '#374151')
      .attr('font-weight', '500')
      .text((d) => d.charAt(0).toUpperCase() + d.slice(1));
  }, [data, width, height]);

  return (
    <div className="relative">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <div className="relative overflow-hidden">
        <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" />
        <div
          ref={tooltipRef}
          className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
