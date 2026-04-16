'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface SpecialtyData {
  code: string;
  display: string;
  providers: number;
}

interface SpecialtyTreemapProps {
  data: SpecialtyData[];
  title: string;
  width?: number;
  height?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  '2': '#3b82f6', // Allopathic & Osteopathic Physicians
  '1': '#8b5cf6', // Behavioral Health
  '3': '#10b981', // Dental
  '36': '#f59e0b', // Nursing
  '37': '#ef4444', // Pharmacy
  '20': '#06b6d4', // Optometry
  '10': '#ec4899', // Respiratory
};

function getCategoryColor(code: string): string {
  const prefix = code.substring(0, Math.min(2, code.length));
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (prefix.startsWith(key)) return color;
  }
  // Hash-based fallback
  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function SpecialtyTreemap({
  data,
  title,
  width = 900,
  height = 500,
}: SpecialtyTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Build hierarchy
    const root = d3.hierarchy({
      name: 'root',
      children: data.map((d) => ({
        name: d.display,
        code: d.code,
        value: d.providers,
      })),
    })
      .sum((d: any) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<any>()
      .size([width, height])
      .padding(2)
      .round(true)(root);

    const leaves = root.leaves();

    const cells = svg
      .selectAll('g')
      .data(leaves)
      .join('g')
      .attr('transform', (d: any) => `translate(${d.x0},${d.y0})`);

    // Rectangles with animated entry
    cells
      .append('rect')
      .attr('width', (d: any) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d: any) => Math.max(0, d.y1 - d.y0))
      .attr('fill', (d: any) => getCategoryColor(d.data.code))
      .attr('opacity', 0)
      .attr('rx', 3)
      .attr('cursor', 'pointer')
      .transition()
      .duration(800)
      .delay((_d: any, i: number) => i * 15)
      .attr('opacity', 0.85);

    // Hover effects
    cells
      .selectAll('rect')
      .on('mouseover', function (event: MouseEvent, d: any) {
        d3.select(this).attr('opacity', 1).attr('stroke', '#1e293b').attr('stroke-width', 2);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'block';
          const svgRect = svgRef.current!.getBoundingClientRect();
          tooltipRef.current.style.left = `${event.clientX - svgRect.left + 12}px`;
          tooltipRef.current.style.top = `${event.clientY - svgRect.top - 40}px`;
          tooltipRef.current.innerHTML = `
            <strong>${d.data.name}</strong><br/>
            <span class="text-gray-300">${d.data.code}</span><br/>
            ${d.data.value.toLocaleString()} providers
          `;
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        if (tooltipRef.current) {
          const svgRect = svgRef.current!.getBoundingClientRect();
          tooltipRef.current.style.left = `${event.clientX - svgRect.left + 12}px`;
          tooltipRef.current.style.top = `${event.clientY - svgRect.top - 40}px`;
        }
      })
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 0.85).attr('stroke', 'none');
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      });

    // Labels (only for cells large enough)
    cells
      .filter((d: any) => (d.x1 - d.x0) > 60 && (d.y1 - d.y0) > 30)
      .append('text')
      .attr('x', 6)
      .attr('y', 18)
      .attr('fill', 'white')
      .attr('font-size', (d: any) => {
        const w = d.x1 - d.x0;
        return w > 120 ? '12px' : '10px';
      })
      .attr('font-weight', '600')
      .attr('pointer-events', 'none')
      .text((d: any) => {
        const maxLen = Math.floor((d.x1 - d.x0 - 12) / 7);
        const name = d.data.name;
        return name.length > maxLen ? name.substring(0, maxLen) + '...' : name;
      });

    // Provider count (for larger cells)
    cells
      .filter((d: any) => (d.x1 - d.x0) > 70 && (d.y1 - d.y0) > 45)
      .append('text')
      .attr('x', 6)
      .attr('y', 34)
      .attr('fill', 'rgba(255,255,255,0.8)')
      .attr('font-size', '10px')
      .attr('pointer-events', 'none')
      .text((d: any) => d.data.value.toLocaleString());
  }, [data, width, height]);

  return (
    <div className="relative">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <div className="relative overflow-hidden rounded-lg">
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
