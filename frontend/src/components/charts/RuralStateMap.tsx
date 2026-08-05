'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export interface RuralStateRow {
  state: string;
  name: string;
  hospitals: number;
  rural: number;
  rural_share: number;
  critical_access: number;
  rural_pop_share: number;
}

/** FIPS -> USPS, so the atlas topology can join to the payload. */
const FIPS_TO_USPS: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
  '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
  '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
  '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
  '55': 'WI', '56': 'WY',
};

// Single-hue sequential scale, quintile-classed. Lightness is monotone so the
// map survives greyscale printing and colour-vision deficiency, and darker
// always means a larger rural share. No diverging ramp, because "share of
// hospitals that are rural" has no meaningful midpoint.
const BLUES = ['#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];

export default function RuralStateMap({
  rows,
  onSelect,
  selected,
}: {
  rows: RuralStateRow[];
  onSelect?: (s: string | null) => void;
  selected?: string | null;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [topo, setTopo] = useState<any>(null);

  useEffect(() => {
    let dead = false;
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
      .then((r) => r.json())
      .then((d) => !dead && setTopo(d))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!topo || !ref.current) return;
    const by = new Map(rows.map((r) => [r.state, r]));
    const shares = rows.map((r) => r.rural_share).sort(d3.ascending);
    const breaks = [0.2, 0.4, 0.6, 0.8].map((q) => d3.quantileSorted(shares, q) as number);
    const cls = (v: number) => {
      for (let i = 0; i < breaks.length; i++) if (v <= breaks[i]) return i;
      return 4;
    };

    const geo = topojson.feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection;
    const width = 900;
    const height = 520;
    const svg = d3.select(ref.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img');

    const path = d3.geoPath(d3.geoAlbersUsa().fitSize([width, height - 30], geo));
    const tip = d3
      .select('body')
      .append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', 'rgba(17,24,39,.95)')
      .style('color', '#fff')
      .style('padding', '8px 10px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('opacity', 0)
      .style('z-index', '50');

    svg
      .append('g')
      .selectAll('path')
      .data(geo.features)
      .join('path')
      .attr('d', path as any)
      .attr('fill', (f: any) => {
        const r = by.get(FIPS_TO_USPS[String(f.id).padStart(2, '0')]);
        return r ? BLUES[cls(r.rural_share)] : '#f0f0f0';
      })
      .attr('stroke', (f: any) =>
        FIPS_TO_USPS[String(f.id).padStart(2, '0')] === selected ? '#111827' : '#fff',
      )
      .attr('stroke-width', (f: any) =>
        FIPS_TO_USPS[String(f.id).padStart(2, '0')] === selected ? 2.4 : 0.8,
      )
      .style('cursor', 'pointer')
      .on('mousemove', (e: MouseEvent, f: any) => {
        const r = by.get(FIPS_TO_USPS[String(f.id).padStart(2, '0')]);
        if (!r) return;
        tip
          .style('opacity', 1)
          .style('left', `${e.pageX + 14}px`)
          .style('top', `${e.pageY - 12}px`)
          .html(
            `<strong>${r.name}</strong><br/>` +
              `${r.rural} of ${r.hospitals} hospitals rural (${r.rural_share}%)<br/>` +
              `${r.critical_access} Critical Access<br/>` +
              `${r.rural_pop_share}% of residents in nonmetro counties`,
          );
      })
      .on('mouseleave', () => tip.style('opacity', 0))
      .on('click', (_e: MouseEvent, f: any) => {
        const s = FIPS_TO_USPS[String(f.id).padStart(2, '0')];
        onSelect?.(s === selected ? null : s);
      });

    const lg = svg.append('g').attr('transform', `translate(20, ${height - 18})`);
    lg.append('text').attr('y', 10).attr('font-size', 11).attr('fill', '#6b7280').text('lower');
    BLUES.forEach((c, i) => {
      lg.append('rect').attr('x', 44 + i * 16).attr('y', 1).attr('width', 15).attr('height', 9).attr('fill', c);
    });
    lg.append('text').attr('x', 128).attr('y', 10).attr('font-size', 11).attr('fill', '#6b7280')
      .text('higher share of hospitals in nonmetro counties');

    return () => {
      tip.remove();
    };
  }, [topo, rows, selected, onSelect]);

  if (!topo) {
    return (
      <div className="h-[380px] flex items-center justify-center bg-white rounded-lg border border-gray-200 text-gray-500">
        Loading map…
      </div>
    );
  }
  return <svg ref={ref} className="w-full h-auto bg-white rounded-lg border border-gray-200" />;
}
