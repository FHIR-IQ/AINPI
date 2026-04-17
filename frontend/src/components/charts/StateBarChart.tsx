'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface StateBarData {
  state: string;
  providers: number;
  organizations: number;
  locations: number;
}

interface StateBarChartProps {
  data: StateBarData[];
  title: string;
  width?: number;
  height?: number;
  top?: number;
  onStateClick?: (state: string) => void;
  selectedState?: string | null;
}

export default function StateBarChart({
  data,
  title,
  width = 900,
  height = 400,
  top = 25,
  onStateClick,
  selectedState,
}: StateBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const sorted = [...data]
      .sort((a, b) => b.providers + b.organizations + b.locations - (a.providers + a.organizations + a.locations))
      .slice(0, top);

    const margin = { top: 20, right: 30, bottom: 40, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const keys = ['providers', 'organizations', 'locations'] as const;
    const colors = { providers: '#3b82f6', organizations: '#8b5cf6', locations: '#10b981' };

    const stackedData = d3.stack<StateBarData>().keys(keys)(sorted);

    const x = d3.scaleBand()
      .domain(sorted.map((d) => d.state))
      .range([0, innerWidth])
      .padding(0.2);

    const maxVal = d3.max(stackedData[stackedData.length - 1], (d) => d[1]) || 0;
    const y = d3.scaleLinear().domain([0, maxVal]).nice().range([innerHeight, 0]);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Gridlines
    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(() => ''))
      .call((el) => el.select('.domain').remove())
      .call((el) => el.selectAll('.tick line').attr('stroke', '#f3f4f6'));

    // Stacked bars
    g.selectAll('g.layer')
      .data(stackedData)
      .join('g')
      .attr('class', 'layer')
      .attr('fill', (d) => colors[d.key as keyof typeof colors])
      .selectAll('rect')
      .data((d) => d)
      .join('rect')
      .attr('x', (d) => x(d.data.state)!)
      .attr('width', x.bandwidth())
      .attr('y', innerHeight)
      .attr('height', 0)
      .attr('rx', 2)
      .attr('cursor', onStateClick ? 'pointer' : 'default')
      .attr('opacity', (d) => selectedState && d.data.state !== selectedState ? 0.35 : 1)
      .on('click', (_event, d) => { if (onStateClick) onStateClick(d.data.state === selectedState ? '' : d.data.state); })
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 0.7);
        if (tooltipRef.current) {
          const svgRect = svgRef.current!.getBoundingClientRect();
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = `${event.clientX - svgRect.left + 12}px`;
          tooltipRef.current.style.top = `${event.clientY - svgRect.top - 50}px`;
          tooltipRef.current.innerHTML = `
            <strong>${d.data.state}</strong><br/>
            <span style="color:${colors.providers}">Providers:</span> ${d.data.providers.toLocaleString()}<br/>
            <span style="color:${colors.organizations}">Organizations:</span> ${d.data.organizations.toLocaleString()}<br/>
            <span style="color:${colors.locations}">Locations:</span> ${d.data.locations.toLocaleString()}
          `;
        }
      })
      .on('mouseout', function (_event, d) {
        d3.select(this).attr('opacity', selectedState && d.data.state !== selectedState ? 0.35 : 1);
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .transition()
      .duration(800)
      .delay((_, i) => i * 30)
      .attr('y', (d) => y(d[1]))
      .attr('height', (d) => y(d[0]) - y(d[1]));

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x))
      .call((el) => el.select('.domain').attr('stroke', '#e5e7eb'))
      .call((el) => el.selectAll('.tick text').attr('fill', '#6b7280').attr('font-size', '11px'));

    // Y axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => {
        const n = d as number;
        return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
      }))
      .call((el) => el.select('.domain').remove())
      .call((el) => el.selectAll('.tick text').attr('fill', '#6b7280').attr('font-size', '11px'));

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${margin.left + innerWidth - 280}, 8)`);
    keys.forEach((key, i) => {
      legend.append('rect')
        .attr('x', i * 100)
        .attr('width', 12)
        .attr('height', 12)
        .attr('rx', 2)
        .attr('fill', colors[key]);
      legend.append('text')
        .attr('x', i * 100 + 16)
        .attr('y', 10)
        .attr('font-size', '11px')
        .attr('fill', '#6b7280')
        .text(key.charAt(0).toUpperCase() + key.slice(1));
    });
  }, [data, width, height, top, onStateClick, selectedState]);

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
