'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

export interface CityData {
  city: string;
  count: number;
  secondary?: number;
}

interface CityBarChartProps {
  data: CityData[];
  title: string;
  countLabel?: string;
  onCityClick?: (city: string) => void;
  selectedCity?: string | null;
  width?: number;
  height?: number;
  top?: number;
}

export default function CityBarChart({
  data,
  title,
  countLabel = 'count',
  onCityClick,
  selectedCity,
  width = 640,
  height = 500,
  top = 20,
}: CityBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, top);
    const margin = { top: 12, right: 60, bottom: 20, left: 140 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const y = d3.scaleBand().domain(sorted.map((d) => d.city)).range([0, innerH]).padding(0.18);
    const maxVal = d3.max(sorted, (d) => d.count) || 1;
    const x = d3.scaleLinear().domain([0, maxVal]).range([0, innerW]);

    const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Gridlines
    g.append('g')
      .attr('transform', 'translate(0,' + innerH + ')')
      .call(d3.axisBottom(x).ticks(5).tickSize(-innerH).tickFormat(() => ''))
      .call((el) => el.select('.domain').remove())
      .call((el) => el.selectAll('.tick line').attr('stroke', '#f3f4f6'));

    // Bars
    g.selectAll('rect.bar')
      .data(sorted)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', (d) => y(d.city)!)
      .attr('height', y.bandwidth())
      .attr('width', 0)
      .attr('rx', 3)
      .attr('fill', (d) => d.city === selectedCity ? '#1e40af' : '#3b82f6')
      .attr('cursor', onCityClick ? 'pointer' : 'default')
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('fill', '#1e40af');
        if (tooltipRef.current && svgRef.current) {
          const rect = svgRef.current.getBoundingClientRect();
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = (event.clientX - rect.left + 12) + 'px';
          tooltipRef.current.style.top = (event.clientY - rect.top - 40) + 'px';
          tooltipRef.current.innerHTML = '<strong>' + d.city + '</strong><br/>' + d.count.toLocaleString() + ' ' + countLabel +
            (d.secondary !== undefined ? '<br/>' + d.secondary.toLocaleString() + ' active' : '');
        }
      })
      .on('mouseout', function (_event, d) {
        d3.select(this).attr('fill', d.city === selectedCity ? '#1e40af' : '#3b82f6');
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .on('click', (_event, d) => { if (onCityClick) onCityClick(d.city); })
      .transition().duration(700).delay((_, i) => i * 20)
      .attr('width', (d) => x(d.count));

    // Value labels (right of bars)
    g.selectAll('text.value')
      .data(sorted)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => x(d.count) + 6)
      .attr('y', (d) => y(d.city)! + y.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#4b5563')
      .text((d) => d.count >= 1000 ? (d.count / 1000).toFixed(1) + 'K' : d.count.toLocaleString());

    // City labels (left axis)
    g.selectAll('text.label')
      .data(sorted)
      .join('text')
      .attr('class', 'label')
      .attr('x', -6)
      .attr('y', (d) => y(d.city)! + y.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#374151')
      .attr('cursor', onCityClick ? 'pointer' : 'default')
      .text((d) => d.city.length > 20 ? d.city.substring(0, 18) + '...' : d.city)
      .on('click', (_event, d) => { if (onCityClick) onCityClick(d.city); });

  }, [data, countLabel, onCityClick, selectedCity, width, height, top]);

  return (
    <div className="relative">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <div className="relative">
        <svg ref={svgRef} width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} className="w-full h-auto" />
        <div ref={tooltipRef} className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10" style={{ display: 'none' }} />
      </div>
    </div>
  );
}
