'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

interface StateData {
  state: string;
  value: number;
}

interface USChoroplethMapProps {
  data: StateData[];
  title: string;
  colorScheme?: 'blues' | 'greens' | 'oranges' | 'purples' | 'reds';
  formatValue?: (value: number) => string;
  width?: number;
  height?: number;
  onStateClick?: (state: string) => void;
  selectedState?: string | null;
}

// FIPS code -> state abbreviation mapping
const FIPS_TO_STATE: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};

const COLOR_SCHEMES = {
  blues: d3.interpolateBlues,
  greens: d3.interpolateGreens,
  oranges: d3.interpolateOranges,
  purples: d3.interpolatePurples,
  reds: d3.interpolateReds,
};

export default function USChoroplethMap({
  data,
  title,
  colorScheme = 'blues',
  formatValue = (v) => v.toLocaleString(),
  width = 960,
  height = 600,
  onStateClick,
  selectedState,
}: USChoroplethMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [topoData, setTopoData] = useState<any>(null);

  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
      .then((res) => res.json())
      .then(setTopoData);
  }, []);

  useEffect(() => {
    if (!svgRef.current || !topoData || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const stateMap = new Map(data.map((d) => [d.state, d.value]));
    const maxVal = d3.max(data, (d) => d.value) || 1;
    const colorScale = d3.scaleSequential(COLOR_SCHEMES[colorScheme]).domain([0, maxVal]);

    const statesGeo = topojson.feature(topoData, topoData.objects.states) as unknown as GeoJSON.FeatureCollection;
    const projection = d3.geoAlbersUsa().fitSize([width, height - 80], statesGeo);
    const path = d3.geoPath().projection(projection);

    // Draw states
    svg
      .append('g')
      .selectAll('path')
      .data(statesGeo.features)
      .join('path')
      .attr('d', path as any)
      .attr('fill', (d: any) => {
        const fips = String(d.id).padStart(2, '0');
        const abbr = FIPS_TO_STATE[fips];
        const val = stateMap.get(abbr);
        return val !== undefined ? colorScale(val) : '#f3f4f6';
      })
      .attr('stroke', (d: any) => {
        const fips = String(d.id).padStart(2, '0');
        const abbr = FIPS_TO_STATE[fips];
        return abbr === selectedState ? '#1e40af' : '#fff';
      })
      .attr('stroke-width', (d: any) => {
        const fips = String(d.id).padStart(2, '0');
        const abbr = FIPS_TO_STATE[fips];
        return abbr === selectedState ? 3 : 0.8;
      })
      .attr('cursor', onStateClick ? 'pointer' : 'default')
      .on('mouseover', function (event: MouseEvent, d: any) {
        const fips = String(d.id).padStart(2, '0');
        const abbr = FIPS_TO_STATE[fips];
        if (abbr !== selectedState) d3.select(this).attr('stroke', '#1e40af').attr('stroke-width', 2);
        const val = stateMap.get(abbr);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = `${event.offsetX + 12}px`;
          tooltipRef.current.style.top = `${event.offsetY - 28}px`;
          tooltipRef.current.innerHTML = `<strong>${abbr || 'Unknown'}</strong><br/>${val !== undefined ? formatValue(val) : 'No data'}${onStateClick ? '<br/><em style="opacity:0.7">Click to filter</em>' : ''}`;
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${event.offsetX + 12}px`;
          tooltipRef.current.style.top = `${event.offsetY - 28}px`;
        }
      })
      .on('mouseout', function (_event, d: any) {
        const fips = String(d.id).padStart(2, '0');
        const abbr = FIPS_TO_STATE[fips];
        if (abbr !== selectedState) {
          d3.select(this).attr('stroke', '#fff').attr('stroke-width', 0.8);
        }
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .on('click', function (_event, d: any) {
        if (!onStateClick) return;
        const fips = String(d.id).padStart(2, '0');
        const abbr = FIPS_TO_STATE[fips];
        if (abbr) onStateClick(abbr === selectedState ? '' : abbr);
      });

    // State borders
    svg
      .append('path')
      .datum(topojson.mesh(topoData, topoData.objects.states, (a: any, b: any) => a !== b))
      .attr('fill', 'none')
      .attr('stroke', '#d1d5db')
      .attr('stroke-width', 0.5)
      .attr('d', path as any);

    // Legend
    const legendWidth = 300;
    const legendHeight = 12;
    const legendX = width - legendWidth - 40;
    const legendY = height - 45;

    const defs = svg.append('defs');
    const linearGradient = defs
      .append('linearGradient')
      .attr('id', `legend-gradient-${colorScheme}`);

    linearGradient
      .selectAll('stop')
      .data(d3.range(0, 1.01, 0.1))
      .join('stop')
      .attr('offset', (d) => `${d * 100}%`)
      .attr('stop-color', (d) => colorScale(d * maxVal));

    svg
      .append('rect')
      .attr('x', legendX)
      .attr('y', legendY)
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .attr('rx', 3)
      .style('fill', `url(#legend-gradient-${colorScheme})`);

    const legendScale = d3.scaleLinear().domain([0, maxVal]).range([legendX, legendX + legendWidth]);
    const legendAxis = d3.axisBottom(legendScale).ticks(5).tickFormat((d) => {
      const n = d as number;
      return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
    });

    svg
      .append('g')
      .attr('transform', `translate(0,${legendY + legendHeight})`)
      .call(legendAxis)
      .call((g) => g.select('.domain').remove())
      .call((g) => g.selectAll('.tick line').attr('stroke', '#9ca3af'))
      .call((g) => g.selectAll('.tick text').attr('fill', '#6b7280').attr('font-size', '11px'));
  }, [topoData, data, colorScheme, formatValue, width, height, onStateClick, selectedState]);

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
