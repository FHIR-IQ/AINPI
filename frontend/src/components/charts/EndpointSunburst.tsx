'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface EndpointData {
  connection_type: string;
  status: string;
  count: number;
  unique_organizations: number;
}

interface EndpointSunburstProps {
  data: EndpointData[];
  title: string;
  size?: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16a34a',
  off: '#9ca3af',
  error: '#dc2626',
  'entered-in-error': '#f59e0b',
  suspended: '#f97316',
  test: '#8b5cf6',
};

const TYPE_COLORS: Record<string, string> = {
  'hl7-fhir-rest': '#3b82f6',
  'hl7-fhir-msg': '#6366f1',
  'direct-project': '#10b981',
  'hl7v2-mllp': '#f59e0b',
};

export default function EndpointSunburst({
  data,
  title,
  size = 450,
}: EndpointSunburstProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = size / 2 - 30;

    // Group by connection type
    const byType = d3.group(data, (d) => d.connection_type);
    const totalEndpoints = d3.sum(data, (d) => d.count);

    // Outer ring: individual status segments
    // Inner ring: connection type totals
    const innerData: { type: string; total: number }[] = [];
    const outerData: { type: string; status: string; count: number; orgs: number }[] = [];

    byType.forEach((items, type) => {
      const total = d3.sum(items, (d) => d.count);
      innerData.push({ type, total });
      items.forEach((item) => {
        outerData.push({ type, status: item.status, count: item.count, orgs: item.unique_organizations });
      });
    });

    // Inner ring (connection types)
    const innerPie = d3.pie<{ type: string; total: number }>()
      .value((d) => d.total)
      .sort(null);

    const innerArc = d3.arc<d3.PieArcDatum<{ type: string; total: number }>>()
      .innerRadius(outerRadius * 0.35)
      .outerRadius(outerRadius * 0.65)
      .padAngle(0.02)
      .cornerRadius(4);

    const innerArcs = innerPie(innerData);

    svg.append('g')
      .attr('transform', `translate(${cx},${cy})`)
      .selectAll('path')
      .data(innerArcs)
      .join('path')
      .attr('d', innerArc)
      .attr('fill', (d) => TYPE_COLORS[d.data.type] || '#6b7280')
      .attr('opacity', 0.9)
      .attr('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1).attr('stroke', '#1e293b').attr('stroke-width', 2);
        showTooltip(event, `
          <strong>${d.data.type}</strong><br/>
          ${d.data.total.toLocaleString()} endpoints<br/>
          ${((d.data.total / totalEndpoints) * 100).toFixed(1)}% of total
        `);
      })
      .on('mousemove', moveTooltip)
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 0.9).attr('stroke', 'none');
        hideTooltip();
      })
      .transition()
      .duration(800)
      .attrTween('d', function (d) {
        const interp = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
        return (t) => innerArc(interp(t) as any) || '';
      });

    // Outer ring (status breakdown)
    // Need to align outer segments with their parent inner segments
    const outerArcGen = d3.arc<d3.PieArcDatum<{ type: string; status: string; count: number; orgs: number }>>()
      .innerRadius(outerRadius * 0.68)
      .outerRadius(outerRadius)
      .padAngle(0.01)
      .cornerRadius(3);

    const outerPie = d3.pie<{ type: string; status: string; count: number; orgs: number }>()
      .value((d) => d.count)
      .sort(null);

    const outerArcs = outerPie(outerData);

    svg.append('g')
      .attr('transform', `translate(${cx},${cy})`)
      .selectAll('path')
      .data(outerArcs)
      .join('path')
      .attr('d', outerArcGen)
      .attr('fill', (d) => STATUS_COLORS[d.data.status] || '#d1d5db')
      .attr('opacity', 0.85)
      .attr('cursor', 'pointer')
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1).attr('stroke', '#1e293b').attr('stroke-width', 2);
        showTooltip(event, `
          <strong>${d.data.type}</strong><br/>
          Status: <span style="color: ${STATUS_COLORS[d.data.status] || '#fff'}">${d.data.status}</span><br/>
          ${d.data.count.toLocaleString()} endpoints<br/>
          ${d.data.orgs.toLocaleString()} organizations
        `);
      })
      .on('mousemove', moveTooltip)
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 0.85).attr('stroke', 'none');
        hideTooltip();
      })
      .transition()
      .duration(1000)
      .delay(400)
      .attrTween('d', function (d) {
        const interp = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
        return (t) => outerArcGen(interp(t) as any) || '';
      });

    // Center label
    svg.append('text')
      .attr('x', cx)
      .attr('y', cy - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '24px')
      .attr('font-weight', '700')
      .attr('fill', '#1e293b')
      .text(totalEndpoints >= 1000000 ? `${(totalEndpoints / 1000000).toFixed(1)}M` : totalEndpoints.toLocaleString());

    svg.append('text')
      .attr('x', cx)
      .attr('y', cy + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', '#6b7280')
      .text('Total Endpoints');

    function showTooltip(event: MouseEvent, html: string) {
      if (!tooltipRef.current) return;
      const svgRect = svgRef.current!.getBoundingClientRect();
      tooltipRef.current.style.display = 'block';
      tooltipRef.current.style.left = `${event.clientX - svgRect.left + 12}px`;
      tooltipRef.current.style.top = `${event.clientY - svgRect.top - 40}px`;
      tooltipRef.current.innerHTML = html;
    }

    function moveTooltip(event: MouseEvent) {
      if (!tooltipRef.current) return;
      const svgRect = svgRef.current!.getBoundingClientRect();
      tooltipRef.current.style.left = `${event.clientX - svgRect.left + 12}px`;
      tooltipRef.current.style.top = `${event.clientY - svgRect.top - 40}px`;
    }

    function hideTooltip() {
      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
    }
  }, [data, size]);

  // Legend
  const legendTypes = [...new Set(data.map((d) => d.connection_type))];
  const legendStatuses = [...new Set(data.map((d) => d.status))];

  return (
    <div className="relative">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <div className="flex gap-6">
        <div className="relative">
          <svg ref={svgRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`} />
          <div
            ref={tooltipRef}
            className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10"
            style={{ display: 'none' }}
          />
        </div>
        <div className="flex flex-col justify-center gap-4 text-sm">
          <div>
            <p className="font-semibold text-gray-600 mb-1">Connection Type (inner)</p>
            {legendTypes.map((type) => (
              <div key={type} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm" style={{ background: TYPE_COLORS[type] || '#6b7280' }} />
                <span className="text-gray-700">{type}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="font-semibold text-gray-600 mb-1">Status (outer)</p>
            {legendStatuses.map((status) => (
              <div key={status} className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm" style={{ background: STATUS_COLORS[status] || '#d1d5db' }} />
                <span className="text-gray-700">{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
