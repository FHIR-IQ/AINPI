'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { PaCounty, PaHospital, PaOverlay } from '@/lib/pa-rural-types';
import { PA_OVERLAYS } from '@/lib/pa-rural-types';

interface Props {
  counties: PaCounty[];
  hospitals: PaHospital[];
  overlay: PaOverlay;
  onCountyClick?: (fips: string | null) => void;
  selectedCounty?: string | null;
}

const PA_STATE_FIPS = '42';

/** Value a county contributes to the current overlay's colour scale. */
function overlayValue(c: PaCounty, overlay: PaOverlay, hospitalCount: number): number | undefined {
  switch (overlay) {
    case 'rural':
      return c.rucc;
    case 'income':
      return c.median_household_income;
    case 'age65':
      return c.pct_65_plus;
    case 'median_age':
      return c.median_age;
    case 'hospitals':
      return hospitalCount;
  }
}

export default function PaCountyMap({
  counties,
  hospitals,
  overlay,
  onCountyClick,
  selectedCounty,
}: Props) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [topo, setTopo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json')
      .then((r) => {
        if (!r.ok) throw new Error(`county atlas ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setTopo(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!topo || !ref.current) return;

    const byFips = new Map(counties.map((c) => [c.fips, c]));
    const hospCount = new Map<string, number>();
    for (const h of hospitals) {
      if (!h.county_fips) continue;
      hospCount.set(h.county_fips, (hospCount.get(h.county_fips) ?? 0) + 1);
    }

    const all = topojson.feature(topo, topo.objects.counties) as unknown as GeoJSON.FeatureCollection;
    const pa = {
      ...all,
      features: all.features.filter((f) => String(f.id).padStart(5, '0').startsWith(PA_STATE_FIPS)),
    };

    const spec = PA_OVERLAYS.find((o) => o.key === overlay)!;
    const values = pa.features
      .map((f) => {
        const fips = String(f.id).padStart(5, '0');
        const c = byFips.get(fips);
        return c ? overlayValue(c, overlay, hospCount.get(fips) ?? 0) : undefined;
      })
      .filter((v): v is number => v !== undefined && !Number.isNaN(v));

    const [lo, hi] = d3.extent(values) as [number, number];
    // Red marks the harder end of each overlay. For income, low is harder;
    // for rurality and age, high is harder. One scale, direction flipped.
    const interp = spec.higherIsWorse
      ? (t: number) => d3.interpolateRdYlGn(1 - t)
      : (t: number) => d3.interpolateRdYlGn(t);
    const color = (v: number | undefined) =>
      v === undefined || Number.isNaN(v) ? '#e5e7eb' : interp(hi === lo ? 0.5 : (v - lo) / (hi - lo));

    const width = 900;
    const height = 560;
    const svg = d3.select(ref.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img');

    const projection = d3.geoAlbers().rotate([77.5, 0]).fitSize([width, height - 60], pa);
    const path = d3.geoPath(projection);

    const tip = d3.select('body').append('div')
      .attr('class', 'pa-map-tip')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', 'rgba(17,24,39,0.95)')
      .style('color', '#fff')
      .style('padding', '8px 10px')
      .style('border-radius', '6px')
      .style('font-size', '12px')
      .style('line-height', '1.4')
      .style('opacity', 0)
      .style('z-index', '50');

    const g = svg.append('g');

    g.selectAll('path')
      .data(pa.features)
      .join('path')
      .attr('d', path as any)
      .attr('fill', (f: any) => {
        const fips = String(f.id).padStart(5, '0');
        const c = byFips.get(fips);
        return color(c ? overlayValue(c, overlay, hospCount.get(fips) ?? 0) : undefined);
      })
      .attr('stroke', (f: any) =>
        String(f.id).padStart(5, '0') === selectedCounty ? '#111827' : '#ffffff',
      )
      .attr('stroke-width', (f: any) =>
        String(f.id).padStart(5, '0') === selectedCounty ? 2.5 : 0.6,
      )
      .style('cursor', 'pointer')
      .on('mousemove', (event: MouseEvent, f: any) => {
        const fips = String(f.id).padStart(5, '0');
        const c = byFips.get(fips);
        if (!c) return;
        const n = hospCount.get(fips) ?? 0;
        tip
          .style('opacity', 1)
          .style('left', `${event.pageX + 14}px`)
          .style('top', `${event.pageY - 12}px`)
          .html(
            `<strong>${c.name} County</strong><br/>` +
              `${c.rural ? 'Nonmetro (rural)' : 'Metro'} · RUCC ${c.rucc ?? 'n/a'}<br/>` +
              `Median income: ${c.median_household_income ? '$' + c.median_household_income.toLocaleString() : 'n/a'}<br/>` +
              `Age 65+: ${c.pct_65_plus?.toFixed(1) ?? 'n/a'}% · median age ${c.median_age?.toFixed(1) ?? 'n/a'}<br/>` +
              `Hospitals: ${n}`,
          );
      })
      .on('mouseleave', () => tip.style('opacity', 0))
      .on('click', (_e: MouseEvent, f: any) => {
        const fips = String(f.id).padStart(5, '0');
        onCountyClick?.(fips === selectedCounty ? null : fips);
      });

    // Hospital markers. There is no per-hospital latitude or longitude in the
    // CMS file and this project keeps all geocoding APIs disabled, so a marker
    // sits at its county centroid with a deterministic offset. Position shows
    // county, never street address. The caption below the map says so.
    const centroids = new Map<string, [number, number]>();
    for (const f of pa.features) {
      const fips = String(f.id).padStart(5, '0');
      centroids.set(fips, path.centroid(f as any));
    }
    const grouped = d3.group(
      hospitals.filter((h) => h.county_fips && centroids.has(h.county_fips)),
      (h) => h.county_fips as string,
    );

    const markers = g.append('g');
    grouped.forEach((list, fips) => {
      const [cx, cy] = centroids.get(fips)!;
      const r = list.length === 1 ? 0 : 9 + list.length * 0.8;
      list.forEach((h, i) => {
        const angle = (i / list.length) * 2 * Math.PI;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        markers
          .append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', h.critical_access ? 5 : 3.6)
          .attr('fill', h.in_cehrt_bundle ? '#1d4ed8' : '#9ca3af')
          .attr('stroke', h.critical_access ? '#111827' : '#ffffff')
          .attr('stroke-width', h.critical_access ? 1.6 : 1)
          .style('cursor', 'pointer')
          .on('mousemove', (event: MouseEvent) => {
            tip
              .style('opacity', 1)
              .style('left', `${event.pageX + 14}px`)
              .style('top', `${event.pageY - 12}px`)
              .html(
                `<strong>${h.name}</strong><br/>${h.city}, ${h.county} County<br/>` +
                  `${h.hospital_type}${h.critical_access ? ' (Critical Access)' : ''}<br/>` +
                  `EHR: ${h.ehr_vendor ?? 'no published bundle found'}<br/>` +
                  `${h.in_cehrt_bundle ? 'In a certified-EHR bundle' : 'Not found in any vendor bundle'}`,
              );
          })
          .on('mouseleave', () => tip.style('opacity', 0));
      });
    });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(16, ${height - 44})`);
    const w = 180;
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'pa-grad');
    d3.range(0, 1.01, 0.1).forEach((t) => {
      grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', interp(t));
    });
    legend.append('rect').attr('width', w).attr('height', 10).attr('fill', 'url(#pa-grad)').attr('rx', 2);
    legend.append('text').attr('y', 24).attr('font-size', 11).attr('fill', '#6b7280')
      .text(spec.format(lo));
    legend.append('text').attr('x', w).attr('y', 24).attr('text-anchor', 'end')
      .attr('font-size', 11).attr('fill', '#6b7280').text(spec.format(hi));

    const key = svg.append('g').attr('transform', `translate(${width - 250}, ${height - 50})`);
    const items: [string, string, number][] = [
      ['In a certified-EHR bundle', '#1d4ed8', 3.6],
      ['No bundle found', '#9ca3af', 3.6],
      ['Critical Access (outlined)', '#1d4ed8', 5],
    ];
    items.forEach(([label, fill, radius], i) => {
      const row = key.append('g').attr('transform', `translate(0, ${i * 16})`);
      row.append('circle').attr('cx', 6).attr('cy', 0).attr('r', radius)
        .attr('fill', fill)
        .attr('stroke', i === 2 ? '#111827' : '#ffffff')
        .attr('stroke-width', i === 2 ? 1.6 : 1);
      row.append('text').attr('x', 18).attr('y', 4).attr('font-size', 11)
        .attr('fill', '#374151').text(label);
    });

    return () => {
      tip.remove();
    };
  }, [topo, counties, hospitals, overlay, selectedCounty, onCountyClick]);

  if (err) {
    return (
      <div className="h-[420px] flex items-center justify-center bg-white rounded-lg border border-gray-200 text-sm text-gray-600 px-6 text-center">
        County boundaries failed to load ({err}). The hospital table below carries the same data.
      </div>
    );
  }

  if (!topo) {
    return (
      <div className="h-[420px] flex items-center justify-center bg-white rounded-lg border border-gray-200 text-gray-500">
        Loading county boundaries…
      </div>
    );
  }

  return <svg ref={ref} className="w-full h-auto bg-white rounded-lg border border-gray-200" />;
}
