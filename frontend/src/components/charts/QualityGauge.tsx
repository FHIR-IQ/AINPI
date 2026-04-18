'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface QualityGaugeProps {
  value: number; // 0-100
  label: string;
  sublabel?: string;
  size?: number;
  thresholds?: { good: number; warning: number }; // defaults: good>=90, warning>=70
}

export default function QualityGauge({
  value,
  label,
  sublabel,
  size = 180,
  thresholds = { good: 90, warning: 70 },
}: QualityGaugeProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const cx = size / 2;
    const cy = size / 2 + 10;
    const radius = size / 2 - 20;
    const startAngle = -Math.PI * 0.75;
    const endAngle = Math.PI * 0.75;
    const angleRange = endAngle - startAngle;

    // Background arc
    const bgArc = d3.arc()
      .innerRadius(radius - 16)
      .outerRadius(radius)
      .startAngle(startAngle)
      .endAngle(endAngle)
      .cornerRadius(8);

    svg.append('path')
      .attr('transform', `translate(${cx},${cy})`)
      .attr('d', bgArc({} as any) as string)
      .attr('fill', '#f3f4f6');

    // Colored segments (red -> yellow -> green)
    const segments = [
      { start: 0, end: thresholds.warning / 100, color: '#fca5a5' },
      { start: thresholds.warning / 100, end: thresholds.good / 100, color: '#fde68a' },
      { start: thresholds.good / 100, end: 1, color: '#86efac' },
    ];

    segments.forEach((seg) => {
      const segArc = d3.arc()
        .innerRadius(radius - 16)
        .outerRadius(radius)
        .startAngle(startAngle + seg.start * angleRange)
        .endAngle(startAngle + seg.end * angleRange)
        .cornerRadius(0);

      svg.append('path')
        .attr('transform', `translate(${cx},${cy})`)
        .attr('d', segArc({} as any) as string)
        .attr('fill', seg.color)
        .attr('opacity', 0.4);
    });

    // Value arc with animation
    const clampedValue = Math.min(Math.max(value, 0), 100);
    const valueColor = clampedValue >= thresholds.good ? '#16a34a' :
                       clampedValue >= thresholds.warning ? '#d97706' : '#dc2626';

    const valueArc = d3.arc()
      .innerRadius(radius - 16)
      .outerRadius(radius)
      .startAngle(startAngle)
      .cornerRadius(8);

    const valuePath = svg.append('path')
      .attr('transform', `translate(${cx},${cy})`)
      .attr('fill', valueColor)
      .datum({ endAngle: startAngle });

    valuePath.transition()
      .duration(1200)
      .ease(d3.easeCubicOut)
      .attrTween('d', function (d: any) {
        const interpolate = d3.interpolate(d.endAngle, startAngle + (clampedValue / 100) * angleRange);
        return function (t: number) {
          d.endAngle = interpolate(t);
          return valueArc(d as any) as string;
        };
      });

    // Needle
    const needleAngle = startAngle + (clampedValue / 100) * angleRange;
    const needleLength = radius - 30;

    const needle = svg.append('line')
      .attr('x1', cx)
      .attr('y1', cy)
      .attr('stroke', '#374151')
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round');

    needle.transition()
      .duration(1200)
      .ease(d3.easeCubicOut)
      .attrTween('x2', () => {
        const interp = d3.interpolate(startAngle, needleAngle);
        return (t: number) => String(cx + Math.cos(interp(t) - Math.PI / 2) * needleLength);
      })
      .attrTween('y2', () => {
        const interp = d3.interpolate(startAngle, needleAngle);
        return (t: number) => String(cy + Math.sin(interp(t) - Math.PI / 2) * needleLength);
      });

    // Center dot
    svg.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 5)
      .attr('fill', '#374151');

    // Value text — scale font to gauge size so "100.0%" doesn't overflow
    // small gauges (size=160 gets ~23px, size=200 gets ~28px).
    const valueFontSize = Math.max(16, Math.floor(size / 7.1));
    const valueText = svg.append('text')
      .attr('x', cx)
      .attr('y', cy + Math.floor(size / 5.7))
      .attr('text-anchor', 'middle')
      .attr('font-size', valueFontSize + 'px')
      .attr('font-weight', '700')
      .attr('fill', valueColor);

    valueText.transition()
      .duration(1200)
      .ease(d3.easeCubicOut)
      .tween('text', function () {
        const interp = d3.interpolate(0, clampedValue);
        return function (t: number) {
          this.textContent = `${interp(t).toFixed(1)}%`;
        };
      });

    // Tick marks
    [0, 25, 50, 75, 100].forEach((tick) => {
      const angle = startAngle + (tick / 100) * angleRange;
      const x1 = cx + Math.cos(angle - Math.PI / 2) * (radius + 4);
      const y1 = cy + Math.sin(angle - Math.PI / 2) * (radius + 4);
      const x2 = cx + Math.cos(angle - Math.PI / 2) * (radius + 12);
      const y2 = cy + Math.sin(angle - Math.PI / 2) * (radius + 12);

      svg.append('line')
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2)
        .attr('stroke', '#9ca3af')
        .attr('stroke-width', 1);

      svg.append('text')
        .attr('x', cx + Math.cos(angle - Math.PI / 2) * (radius + 22))
        .attr('y', cy + Math.sin(angle - Math.PI / 2) * (radius + 22))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#9ca3af')
        .text(tick);
    });
  }, [value, size, thresholds]);

  return (
    <div className="flex flex-col items-center">
      <svg ref={svgRef} width={size} height={size + 20} style={{ overflow: 'visible' }} />
      <p className="text-sm font-semibold text-gray-700 -mt-2">{label}</p>
      {sublabel && <p className="text-xs text-gray-500">{sublabel}</p>}
    </div>
  );
}
