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
  onSpecialtyClick?: (specialtyDisplay: string) => void;
  selectedSpecialty?: string | null;
}

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#a855f7',
];

function getCategoryColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = code.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

interface TreeLeaf extends d3.HierarchyRectangularNode<{ name: string; code: string; value: number }> {}

export default function SpecialtyTreemap({
  data,
  title,
  width = 900,
  height = 500,
  onSpecialtyClick,
  selectedSpecialty,
}: SpecialtyTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!svgRef.current || !data || data.length === 0) return;

    // Sanitize data
    const cleaned = data
      .filter((d) => d && typeof d.providers === 'number' && d.providers > 0)
      .map((d) => ({ name: d.display || 'Unknown', code: d.code || '', value: d.providers }));

    if (cleaned.length === 0) return;

    const root = d3.hierarchy({ children: cleaned } as { children: { name: string; code: string; value: number }[] })
      .sum((d) => ('value' in d ? (d as { value?: number }).value || 0 : 0))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<{ name: string; code: string; value: number }>()
      .size([width, height])
      .padding(2)
      .round(true)(root as unknown as d3.HierarchyNode<{ name: string; code: string; value: number }>);

    const leaves = root.leaves() as unknown as TreeLeaf[];

    // One <g> per cell containing rect + text
    const cells = svg
      .selectAll('g.cell')
      .data(leaves)
      .join('g')
      .attr('class', 'cell')
      .attr('transform', (d) => 'translate(' + d.x0 + ',' + d.y0 + ')');

    // Rectangles — set opacity based on selection in a single attribute, no racing transitions
    cells.append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 3)
      .attr('fill', (d) => getCategoryColor(d.data.code))
      .attr('cursor', onSpecialtyClick ? 'pointer' : 'default')
      .attr('stroke', (d) => selectedSpecialty && d.data.name === selectedSpecialty ? '#1e40af' : 'none')
      .attr('stroke-width', (d) => selectedSpecialty && d.data.name === selectedSpecialty ? 2 : 0)
      .attr('opacity', (d) => selectedSpecialty && d.data.name !== selectedSpecialty ? 0.35 : 0.85)
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1);
        if (tooltipRef.current) {
          const rect = svgRef.current!.getBoundingClientRect();
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = (event.clientX - rect.left + 12) + 'px';
          tooltipRef.current.style.top = (event.clientY - rect.top - 40) + 'px';
          tooltipRef.current.innerHTML =
            '<strong>' + d.data.name + '</strong><br/>' +
            '<span class="text-gray-300">' + d.data.code + '</span><br/>' +
            d.data.value.toLocaleString() + ' providers';
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        if (tooltipRef.current && svgRef.current) {
          const rect = svgRef.current.getBoundingClientRect();
          tooltipRef.current.style.left = (event.clientX - rect.left + 12) + 'px';
          tooltipRef.current.style.top = (event.clientY - rect.top - 40) + 'px';
        }
      })
      .on('mouseout', function (_event, d) {
        const isSelected = !!(selectedSpecialty && d.data.name === selectedSpecialty);
        d3.select(this).attr('opacity', selectedSpecialty && !isSelected ? 0.35 : 0.85);
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .on('click', (_event, d) => {
        if (!onSpecialtyClick) return;
        onSpecialtyClick(d.data.name === selectedSpecialty ? '' : d.data.name);
      });

    // Labels — name + provider count for cells big enough to hold them
    cells.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 60 || h < 30) return;
      const g = d3.select(this);

      const maxChars = Math.floor((w - 12) / 7);
      const name = d.data.name;
      g.append('text')
        .attr('x', 6)
        .attr('y', 18)
        .attr('fill', 'white')
        .attr('font-size', w > 120 ? '12px' : '10px')
        .attr('font-weight', '600')
        .attr('pointer-events', 'none')
        .text(name.length > maxChars ? name.substring(0, Math.max(maxChars - 1, 1)) + '…' : name);

      if (w > 70 && h > 45) {
        g.append('text')
          .attr('x', 6)
          .attr('y', 34)
          .attr('fill', 'rgba(255,255,255,0.85)')
          .attr('font-size', '10px')
          .attr('pointer-events', 'none')
          .text(d.data.value.toLocaleString());
      }
    });
  }, [data, width, height, onSpecialtyClick, selectedSpecialty]);

  return (
    <div className="relative">
      {title && <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>}
      <div className="relative overflow-hidden rounded-lg">
        <svg ref={svgRef} width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} className="w-full h-auto" />
        <div
          ref={tooltipRef}
          className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
