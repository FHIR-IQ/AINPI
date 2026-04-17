'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface SankeyNode {
  id: string;
  name: string;
  type: 'organization' | 'practitioner' | 'endpoint' | 'location';
  count?: number;
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

interface SankeyGraphProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  title: string;
  width?: number;
  height?: number;
}

const TYPE_COLORS: Record<string, string> = {
  organization: '#8b5cf6',
  practitioner: '#3b82f6',
  endpoint: '#10b981',
  location: '#f59e0b',
};

export default function SankeyGraph({
  nodes,
  links,
  title,
  width = 1200,
  height = 600,
}: SankeyGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 200, bottom: 20, left: 200 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    // Group nodes by type into columns
    const columns: Record<string, SankeyNode[]> = { organization: [], practitioner: [], endpoint: [], location: [] };
    nodes.forEach((n) => { if (columns[n.type]) columns[n.type].push(n); });

    const colOrder = ['organization', 'practitioner', 'endpoint'];
    const activeColumns = colOrder.filter((c) => columns[c].length > 0);
    if (columns.location.length > 0) activeColumns.push('location');

    const colWidth = innerW / Math.max(activeColumns.length - 1, 1);
    const nodeWidth = 20;
    const nodePadding = 4;

    // Position nodes
    const nodeMap = new Map<string, { x: number; y: number; h: number; node: SankeyNode }>();
    activeColumns.forEach((col, ci) => {
      const colNodes = columns[col].sort((a, b) => (b.count || 0) - (a.count || 0));
      const totalValue = colNodes.reduce((s, n) => s + (n.count || 1), 0);
      let yOffset = 0;
      colNodes.forEach((n) => {
        const h = Math.max(((n.count || 1) / totalValue) * innerH - nodePadding, 3);
        nodeMap.set(n.id, { x: ci * colWidth, y: yOffset, h, node: n });
        yOffset += h + nodePadding;
      });
    });

    const g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    // Draw links
    const validLinks = links.filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target));
    const maxLinkValue = d3.max(validLinks, (l) => l.value) || 1;

    g.selectAll('path.link')
      .data(validLinks)
      .join('path')
      .attr('class', 'link')
      .attr('d', (d) => {
        const s = nodeMap.get(d.source)!;
        const t = nodeMap.get(d.target)!;
        const sy = s.y + s.h / 2;
        const ty = t.y + t.h / 2;
        const sx = s.x + nodeWidth;
        const tx = t.x;
        const curvature = 0.5;
        const xi = d3.interpolateNumber(sx, tx);
        const x2 = xi(curvature);
        const x3 = xi(1 - curvature);
        return 'M' + sx + ',' + sy + 'C' + x2 + ',' + sy + ' ' + x3 + ',' + ty + ' ' + tx + ',' + ty;
      })
      .attr('fill', 'none')
      .attr('stroke', (d) => {
        const s = nodeMap.get(d.source);
        return s ? TYPE_COLORS[s.node.type] || '#94a3b8' : '#94a3b8';
      })
      .attr('stroke-opacity', 0.15)
      .attr('stroke-width', (d) => Math.max(1, (d.value / maxLinkValue) * 20))
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('stroke-opacity', 0.5);
        const s = nodeMap.get(d.source)!;
        const t = nodeMap.get(d.target)!;
        showTooltip(event, '<strong>' + s.node.name + '</strong> &rarr; <strong>' + t.node.name + '</strong><br/>' + d.value.toLocaleString() + ' connections');
      })
      .on('mouseout', function () {
        d3.select(this).attr('stroke-opacity', 0.15);
        hideTooltip();
      })
      .attr('stroke-dasharray', function () { return (this as SVGPathElement).getTotalLength() + ' ' + (this as SVGPathElement).getTotalLength(); })
      .attr('stroke-dashoffset', function () { return (this as SVGPathElement).getTotalLength(); })
      .transition().duration(1500).ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Draw nodes
    const nodeEntries = Array.from(nodeMap.entries());
    const nodeGroups = g.selectAll('g.node')
      .data(nodeEntries)
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => 'translate(' + d[1].x + ',' + d[1].y + ')');

    nodeGroups.append('rect')
      .attr('width', nodeWidth)
      .attr('height', (d) => d[1].h)
      .attr('rx', 3)
      .attr('fill', (d) => TYPE_COLORS[d[1].node.type] || '#6b7280')
      .attr('cursor', 'pointer')
      .attr('opacity', 0)
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).attr('opacity', 1);
        showTooltip(event, '<strong>' + d[1].node.name + '</strong><br/>' +
          d[1].node.type.charAt(0).toUpperCase() + d[1].node.type.slice(1) + '<br/>' +
          (d[1].node.count || 0).toLocaleString() + ' records');
      })
      .on('mouseout', function () {
        d3.select(this).attr('opacity', 0.85);
        hideTooltip();
      })
      .transition().duration(800).delay((_, i) => i * 30)
      .attr('opacity', 0.85);

    // Node labels
    nodeGroups
      .filter((d) => d[1].h > 12)
      .append('text')
      .attr('x', (d) => {
        const col = activeColumns.indexOf(d[1].node.type);
        return col === 0 ? -6 : nodeWidth + 6;
      })
      .attr('y', (d) => d[1].h / 2)
      .attr('text-anchor', (d) => {
        const col = activeColumns.indexOf(d[1].node.type);
        return col === 0 ? 'end' : 'start';
      })
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#374151')
      .attr('pointer-events', 'none')
      .text((d) => {
        const name = d[1].node.name;
        return name.length > 30 ? name.substring(0, 28) + '...' : name;
      });

    // Column headers
    activeColumns.forEach((col, i) => {
      g.append('text')
        .attr('x', i * colWidth + nodeWidth / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('font-size', '13px')
        .attr('font-weight', '700')
        .attr('fill', TYPE_COLORS[col])
        .text(col.charAt(0).toUpperCase() + col.slice(1) + 's (' + columns[col].length + ')');
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
  }, [nodes, links, width, height]);

  return (
    <div className="relative">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <div className="flex gap-3 mb-3">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-3 h-3 rounded" style={{ background: color }} />
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </div>
        ))}
      </div>
      <div className="relative overflow-x-auto">
        <svg ref={svgRef} width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} className="w-full h-auto" />
        <div ref={tooltipRef} className="absolute hidden bg-gray-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg pointer-events-none z-10" style={{ display: 'none' }} />
      </div>
    </div>
  );
}
