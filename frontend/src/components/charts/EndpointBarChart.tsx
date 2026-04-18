'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface EndpointData {
  connection_type: string;
  status: string;
  count: number;
  unique_organizations: number;
}

interface EndpointBarChartProps {
  data: EndpointData[];
  title: string;
  width?: number;
  height?: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  off: '#9ca3af',
  error: '#dc2626',
  'entered-in-error': '#f59e0b',
  suspended: '#f97316',
  test: '#8b5cf6',
};
const FALLBACK_COLOR = '#d1d5db';

const TYPE_LABELS: Record<string, string> = {
  'hl7-fhir-rest': 'HL7 FHIR REST',
  'hl7-fhir-msg': 'HL7 FHIR Msg',
  'direct-project': 'Direct Project',
  'hl7v2-mllp': 'HL7v2 MLLP',
};

export default function EndpointBarChart({
  data,
  title,
  width = 640,
  height = 340,
}: EndpointBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 40, left: 140 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    // Aggregate: group by connection_type, pivot statuses
    const byType = d3.group(data, (d) => d.connection_type);
    const statuses = [...new Set(data.map((d) => d.status))];

    const rows = Array.from(byType.entries()).map(([type, items]) => {
      const row: Record<string, number | string> = { type };
      let total = 0;
      statuses.forEach((s) => {
        const item = items.find((i) => i.status === s);
        const v = item ? item.count : 0;
        row[s] = v;
        total += v;
      });
      row.total = total;
      row.unique_orgs = d3.sum(items, (i) => i.unique_organizations);
      return row;
    }).sort((a, b) => (b.total as number) - (a.total as number));

    const maxTotal = d3.max(rows, (r) => r.total as number) || 1;

    const y = d3.scaleBand()
      .domain(rows.map((r) => r.type as string))
      .range([0, innerH])
      .padding(0.25);

    const x = d3.scaleLinear()
      .domain([0, maxTotal])
      .range([0, innerW]);

    const stack = d3.stack<Record<string, number | string>>()
      .keys(statuses)
      .value((d, key) => (d[key] as number) || 0);

    const stacked = stack(rows);

    const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Gridlines
    g.selectAll('line.grid')
      .data(x.ticks(5))
      .join('line')
      .attr('class', 'grid')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#f3f4f6')
      .attr('stroke-width', 1);

    // Stacked bars
    stacked.forEach((layer) => {
      const status = layer.key;
      const color = STATUS_COLORS[status] || FALLBACK_COLOR;

      g.selectAll('rect.bar-' + status.replace(/[^a-z0-9]/g, '_'))
        .data(layer)
        .join('rect')
        .attr('class', 'bar-' + status.replace(/[^a-z0-9]/g, '_'))
        .attr('y', (d) => y(d.data.type as string)!)
        .attr('height', y.bandwidth())
        .attr('rx', 2)
        .attr('fill', color)
        .attr('opacity', 0.85)
        .attr('x', (d) => x(d[0]))
        .attr('width', 0)
        .on('mouseover', function (event: MouseEvent, d) {
          d3.select(this).attr('opacity', 1);
          const count = (d[1] - d[0]);
          const type = d.data.type as string;
          if (tooltipRef.current && svgRef.current) {
            const rect = svgRef.current.getBoundingClientRect();
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.style.left = (event.clientX - rect.left + 12) + 'px';
            tooltipRef.current.style.top = (event.clientY - rect.top - 48) + 'px';
            tooltipRef.current.innerHTML =
              '<strong>' + (TYPE_LABELS[type] || type) + '</strong><br/>' +
              'Status: <span style="color:' + color + '">' + status + '</span><br/>' +
              count.toLocaleString() + ' endpoints';
          }
        })
        .on('mousemove', function (event: MouseEvent) {
          if (tooltipRef.current && svgRef.current) {
            const rect = svgRef.current.getBoundingClientRect();
            tooltipRef.current.style.left = (event.clientX - rect.left + 12) + 'px';
            tooltipRef.current.style.top = (event.clientY - rect.top - 48) + 'px';
          }
        })
        .on('mouseout', function () {
          d3.select(this).attr('opacity', 0.85);
          if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        })
        .transition()
        .duration(700)
        .delay((_, i) => i * 80)
        .attr('x', (d) => x(d[0]))
        .attr('width', (d) => Math.max(0, x(d[1]) - x(d[0])));
    });

    // Total label at end of bar
    g.selectAll('text.total-label')
      .data(rows)
      .join('text')
      .attr('class', 'total-label')
      .attr('x', (d) => x(d.total as number) + 4)
      .attr('y', (d) => y(d.type as string)! + y.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#6b7280')
      .attr('opacity', 0)
      .text((d) => {
        const n = d.total as number;
        return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'K' : String(n);
      })
      .transition()
      .duration(400)
      .delay((_, i) => i * 80 + 500)
      .attr('opacity', 1);

    // Y axis (type labels)
    g.append('g')
      .call(
        d3.axisLeft(y)
          .tickFormat((d) => TYPE_LABELS[d] || d)
          .tickSize(0)
      )
      .select('.domain').remove();

    g.selectAll('.tick text')
      .attr('font-size', '12px')
      .attr('fill', '#374151');

    // X axis
    g.append('g')
      .attr('transform', 'translate(0,' + innerH + ')')
      .call(
        d3.axisBottom(x)
          .ticks(5)
          .tickFormat((d) => {
            const n = d as number;
            return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'K' : String(n);
          })
      )
      .select('.domain').remove();

    g.selectAll('.tick line').attr('stroke', '#e5e7eb');

    // X axis label
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 34)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#9ca3af')
      .text('Number of Endpoints');
  }, [data, width, height]);

  const statuses = [...new Set(data.map((d) => d.status))];
  const totalEndpoints = data.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      {title && <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {statuses.map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS[s] || FALLBACK_COLOR }} />
            {s}
          </div>
        ))}
        <span className="ml-auto text-xs text-gray-400">
          {totalEndpoints >= 1000 ? (totalEndpoints / 1000).toFixed(1) + 'K' : totalEndpoints.toLocaleString()} total endpoints
        </span>
      </div>
      <div className="relative">
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
