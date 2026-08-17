'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

import {
  GEO_LAYERS,
  type ConnectivityGeo,
  type ConnectivityCounty,
  type ConnectivityGeoOrg,
  type GeoLayerKey,
} from '@/lib/connectivity-types';

/**
 * County choropleth plus an organization point layer, for one state.
 *
 * The design decisions here are the ones that separate a map that informs
 * from a map that decorates, and each is deliberate:
 *
 * **Rate, never count.** A choropleth of counts is a population map wearing a
 * different hat: Philadelphia leads every count because Philadelphia has the
 * most people. Every layer is a share or a per-capita rate. Counts appear in
 * the tooltip where they belong.
 *
 * **Missing is not zero.** A county with no practitioners is hatched, not
 * given the palest colour. Reading "no data" as "worst performing" is the most
 * common way a choropleth lies, and it is entirely avoidable.
 *
 * **Quantile bins with the breaks printed.** Rates here are severely skewed:
 * Montour County has 4,001 practitioners per 10,000 residents because
 * Geisinger is headquartered in it. A linear ramp spends its whole range on
 * that one county and renders the other 66 identical. Quantile bins fix that
 * and the legend prints the actual break values, so the reader is never
 * guessing what a shade means.
 *
 * **The legend is a histogram.** Showing the distribution under the ramp tells
 * the reader whether a bin holds two counties or twenty, which a row of
 * swatches cannot.
 *
 * **Constant spatial layout across layers.** Switching layer changes the
 * encoding and never the geometry, so the eye can hold position between
 * views. Same rule the landscape treemap follows.
 *
 * **Proportional symbols for magnitude.** Organizations are circles scaled by
 * the square root of practitioner count, because area reads as magnitude and
 * radius does not. Reachability is fill plus stroke, so it survives greyscale
 * and colour blindness.
 *
 * **Semantic zoom.** Points are noise at state level and the signal at city
 * level, so they fade in as the reader zooms. Stroke widths are divided by the
 * zoom factor so hairlines stay hairlines.
 */

// ColorBrewer Blues, terminating at the project's primary-600. Monotonic in
// lightness, so it survives greyscale printing and every form of colour
// blindness. Chart ramps here are under the same constraint as the treemap.
const RAMP = ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];
const NO_DATA = '#e9e5e0';
const INK = '#171310';
const SIGNAL = '#a8321c';
const PAPER = '#faf8f5';

const BINS = RAMP.length;

function formatValue(v: number, unit: string) {
  if (unit === '$') return `$${d3.format(',.0f')(v)}`;
  if (unit === '%') return `${d3.format('.1f')(v)}%`;
  return d3.format(v >= 100 ? ',.0f' : ',.1f')(v);
}

export default function StateGeoMap({
  geo,
  stateFips,
  stateName,
  height = 560,
}: {
  geo: ConnectivityGeo;
  stateFips: string;
  stateName: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(880);
  const [topo, setTopo] = useState<any>(null);
  const [atlasError, setAtlasError] = useState<string | null>(null);
  const [layer, setLayer] = useState<GeoLayerKey>('endpoint_pct');
  const [showPoints, setShowPoints] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hover, setHover] = useState<
    { kind: 'county'; d: ConnectivityCounty } | { kind: 'org'; d: ConnectivityGeoOrg } | null
  >(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.max(320, entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json')
      .then((r) => {
        if (!r.ok) throw new Error(`county atlas ${r.status}`);
        return r.json();
      })
      .then((d) => !cancelled && setTopo(d))
      .catch((e) => !cancelled && setAtlasError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const meta = GEO_LAYERS.find((l) => l.key === layer)!;
  const byFips = useMemo(
    () => new Map(geo.counties.map((c) => [c.fips, c])),
    [geo.counties],
  );

  // Quantile domain built only from counties that actually have a value, so
  // the missing ones do not drag a bin edge to zero.
  const values = useMemo(
    () =>
      geo.counties
        .map((c) => c[layer] as number | null)
        .filter((v): v is number => v !== null && Number.isFinite(v)),
    [geo.counties, layer],
  );

  const scale = useMemo(
    () => d3.scaleQuantile<string>().domain(values).range(RAMP),
    [values],
  );

  useEffect(() => {
    if (!svgRef.current || !topo) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const all = topojson.feature(
      topo,
      topo.objects.counties,
    ) as unknown as GeoJSON.FeatureCollection;
    const features = all.features.filter((f) =>
      String(f.id).startsWith(stateFips),
    );
    if (!features.length) return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    // Fitted conic projection rather than geoAlbersUsa: the national
    // projection is tuned for the whole country and visibly shears a single
    // state. Parallels are derived from the state's own extent.
    const bounds = d3.geoBounds(fc);
    const projection = d3
      .geoConicEqualArea()
      .parallels([
        bounds[0][1] + (bounds[1][1] - bounds[0][1]) / 3,
        bounds[0][1] + (2 * (bounds[1][1] - bounds[0][1])) / 3,
      ])
      .rotate([-(bounds[0][0] + bounds[1][0]) / 2, 0])
      .fitExtent(
        [
          [12, 12],
          [width - 12, height - 12],
        ],
        fc,
      );
    const path = d3.geoPath(projection);

    const defs = svg.append('defs');
    // Hatch for counties with no denominator. A pattern rather than a colour
    // so it cannot be misread as a position on the ramp.
    const hatch = defs
      .append('pattern')
      .attr('id', 'nodata-hatch')
      .attr('width', 5)
      .attr('height', 5)
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('patternTransform', 'rotate(45)');
    hatch
      .append('rect')
      .attr('width', 5)
      .attr('height', 5)
      .attr('fill', NO_DATA);
    hatch
      .append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 5)
      .attr('stroke', '#b9b2a8')
      .attr('stroke-width', 1.5);

    const root = svg.append('g');
    const countyG = root.append('g');
    const pointG = root.append('g');
    const labelG = root.append('g').attr('pointer-events', 'none');

    countyG
      .selectAll('path')
      .data(features)
      .join('path')
      .attr('d', path as any)
      .attr('fill', (f) => {
        const c = byFips.get(String(f.id));
        const v = c ? (c[layer] as number | null) : null;
        return v === null || v === undefined ? 'url(#nodata-hatch)' : scale(v);
      })
      .attr('stroke', PAPER)
      .attr('stroke-width', 0.6)
      .style('cursor', 'pointer')
      .on('mouseenter', (_, f) => {
        const c = byFips.get(String(f.id));
        if (c) setHover({ kind: 'county', d: c });
      })
      .on('mouseleave', () => setHover(null));

    // State outline, drawn once over the fills so county seams read as
    // hairlines and the silhouette stays crisp.
    root
      .append('path')
      .datum(topojson.merge(topo, topo.objects.counties.geometries.filter(
        (g: any) => String(g.id).startsWith(stateFips),
      )) as any)
      .attr('d', path as any)
      .attr('fill', 'none')
      .attr('stroke', INK)
      .attr('stroke-width', 0.9)
      .attr('pointer-events', 'none');

    const maxPrac =
      d3.max(geo.organizations, (o) => o.practitioners) ?? 1;
    const radius = d3
      .scaleSqrt()
      .domain([1, maxPrac])
      .range([1.6, 22]);

    // Semantic zoom: at state level only organizations big enough to be
    // legible are drawn, and smaller ones appear as the reader zooms in. All
    // 5,278 at once is a solid mat of circles over the cities, which hides
    // both the map underneath and the pattern in the points themselves.
    // Reveal by size rather than at random so what appears first is what
    // carries the most practitioners.
    const minVisible = (k: number) => (k <= 1.01 ? 20 : k < 2 ? 8 : k < 4 ? 3 : 1);

    const points = pointG
      .selectAll('circle')
      .data(showPoints ? geo.organizations : [])
      .join('circle')
      .attr('cx', (o) => projection([o.lng, o.lat])?.[0] ?? -99)
      .attr('cy', (o) => projection([o.lng, o.lat])?.[1] ?? -99)
      .attr('r', (o) => radius(Math.max(1, o.practitioners)))
      .attr('fill', (o) => (o.tier ? '#08519c' : 'none'))
      .attr('fill-opacity', 0.5)
      .attr('stroke', (o) => (o.tier ? '#08519c' : SIGNAL))
      .attr('stroke-width', 0.9)
      .attr('display', (o) =>
        o.practitioners >= minVisible(1) ? null : 'none',
      )
      .style('cursor', 'pointer')
      .on('mouseenter', (_, o) => setHover({ kind: 'org', d: o }))
      .on('mouseleave', () => setHover(null));

    // Annotate the single most extreme county on the active layer. An outlier
    // that distorts a scale should be named on the map, not left for the
    // reader to discover by hovering every shape.
    const extreme = geo.counties
      .filter((c) => c[layer] !== null && c[layer] !== undefined)
      .sort((a, b) => (b[layer] as number) - (a[layer] as number))[0];
    if (extreme) {
      const f = features.find((x) => String(x.id) === extreme.fips);
      if (f) {
        const [cx, cy] = path.centroid(f as any);
        labelG
          .append('text')
          .attr('x', cx)
          .attr('y', cy - 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', 10)
          .attr('font-weight', 600)
          .attr('fill', INK)
          .attr('stroke', PAPER)
          .attr('stroke-width', 3)
          .attr('paint-order', 'stroke')
          .text(
            `${extreme.name} ${formatValue(extreme[layer] as number, meta.unit)}`,
          );
      }
    }

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .on('zoom', (event) => {
        const k = event.transform.k;
        root.attr('transform', event.transform.toString());
        // Keep strokes and labels visually constant through the zoom.
        countyG.selectAll('path').attr('stroke-width', 0.6 / k);
        const floor = minVisible(k);
        points
          .attr('stroke-width', 0.9 / k)
          // Divided by sqrt(k) against a transform that multiplies by k, so
          // circles grow as sqrt(zoom): they stay clickable when zoomed out
          // and stop swallowing the county underneath when zoomed in.
          .attr('r', (o: any) =>
            radius(Math.max(1, o.practitioners)) / Math.sqrt(k),
          )
          .attr('display', (o: any) =>
            o.practitioners >= floor ? null : 'none',
          );
        labelG.attr('font-size', 10 / k).selectAll('text')
          .attr('font-size', 10 / k)
          .attr('stroke-width', 3 / k);
        setZoomLevel(k);
      });
    svg.call(zoom);
    svg.on('dblclick.zoom', null);

    return () => {
      svg.on('.zoom', null);
    };
  }, [topo, width, height, layer, showPoints, byFips, scale, geo, stateFips, meta.unit]);

  // Legend: a strip of the actual distribution, one dot per county, with the
  // bin edges drawn across it.
  //
  // A histogram of the bins was the first attempt and it was useless: these
  // are equal-count bins, so every bar came out the same height by
  // construction. Plotting the values on a linear axis instead shows the
  // reader the shape they are actually looking at, including why quantile
  // bins are necessary at all. On the per-capita layer one dot sits far to
  // the right of everything else, and that dot is the reason a linear colour
  // ramp would render this map blank.
  const thresholds = scale.quantiles();
  const noData = geo.counties.length - values.length;
  const extent = useMemo(
    () => d3.extent(values) as [number, number],
    [values],
  );
  const STRIP_W = 300;
  const stripX = useMemo(
    () =>
      d3
        .scaleLinear()
        .domain(extent[0] === undefined ? [0, 1] : extent)
        .range([0, STRIP_W]),
    [extent],
  );
  const binOf = (v: number) => {
    let i = 0;
    while (i < thresholds.length && v >= thresholds[i]) i += 1;
    return i;
  };

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {GEO_LAYERS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLayer(l.key)}
            aria-pressed={layer === l.key}
            className={`border px-2.5 py-1 text-xs transition-colors ${
              layer === l.key
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-500'
            }`}
          >
            {l.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={showPoints}
            onChange={(e) => setShowPoints(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Organizations ({geo.point_layer.organizations_plotted.toLocaleString('en-US')},
          smaller ones appear as you zoom)
        </label>
      </div>

      <p className="measure mb-3 text-sm text-gray-600">{meta.blurb}</p>

      <div className="relative border border-gray-200 bg-white">
        {atlasError && (
          <p className="p-4 text-sm text-signal">
            County boundaries could not be loaded ({atlasError}). The numbers
            below the map are unaffected.
          </p>
        )}
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={`Choropleth of ${stateName} counties shaded by ${meta.label}, with ${geo.point_layer.organizations_plotted} organizations plotted as proportional circles filled where a FHIR endpoint is reachable.`}
        />
        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-xs border border-gray-300 bg-paper/95 p-3 text-xs shadow-sm">
            {hover.kind === 'county' ? (
              <>
                <p className="font-medium text-ink">
                  {hover.d.name} County
                  {hover.d.rural ? ' · rural' : ''}
                </p>
                <p className="mt-1 text-gray-600">
                  {hover.d.practitioners.toLocaleString('en-US')} practitioners
                  {hover.d.population
                    ? ` · ${hover.d.practitioners_per_10k} per 10k residents`
                    : ''}
                  .
                </p>
                <p className="mt-1 text-gray-600">
                  {hover.d.with_role.toLocaleString('en-US')} have an
                  affiliation ({hover.d.role_pct ?? '—'}%);{' '}
                  {hover.d.reaches_endpoint.toLocaleString('en-US')} reach an
                  endpoint ({hover.d.endpoint_pct ?? '—'}%).
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-ink">{hover.d.name}</p>
                <p className="mt-1 text-gray-600">
                  {hover.d.city ?? ''}
                  {hover.d.sites ? ` · ${hover.d.sites} sited location(s)` : ''}
                  {' · '}
                  {hover.d.practitioners.toLocaleString('en-US')} practitioners.
                </p>
                <p className="mt-1 text-gray-600">
                  {hover.d.tier
                    ? `Endpoint reached via ${hover.d.tier}${
                        hover.d.vendor ? `, served by ${hover.d.vendor}` : ''
                      }.`
                    : 'Nothing public reaches an endpoint for this organization.'}
                </p>
              </>
            )}
          </div>
        )}
        <p className="absolute bottom-2 right-3 text-[11px] text-gray-500">
          Scroll to zoom, drag to pan
          {zoomLevel > 1.05 ? ` · ${zoomLevel.toFixed(1)}×` : ''}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <p className="eyebrow mb-1.5">{meta.label}</p>
          <svg width={STRIP_W + 20} height={54} role="presentation">
            <g transform="translate(10,0)">
              {/* Bin edges, drawn behind the dots. */}
              {thresholds.map((t) => (
                <line
                  key={t}
                  x1={stripX(t)}
                  x2={stripX(t)}
                  y1={2}
                  y2={26}
                  stroke="#b9b2a8"
                  strokeWidth={1}
                />
              ))}
              {/* One dot per county, at its real value. */}
              {values.map((v, i) => (
                <circle
                  key={`${v}-${i}`}
                  cx={stripX(v)}
                  cy={14}
                  r={3.5}
                  fill={RAMP[binOf(v)]}
                  stroke={INK}
                  strokeOpacity={0.35}
                  strokeWidth={0.6}
                />
              ))}
              <line x1={0} x2={STRIP_W} y1={30} y2={30} stroke="#b9b2a8" />
              <text x={0} y={44} fontSize={10} fill="#6b6259">
                {formatValue(extent[0] ?? 0, meta.unit)}
              </text>
              <text
                x={STRIP_W}
                y={44}
                fontSize={10}
                textAnchor="end"
                fill="#6b6259"
              >
                {formatValue(extent[1] ?? 0, meta.unit)}
              </text>
            </g>
          </svg>
          <p className="mt-0.5 max-w-[320px] text-[11px] text-gray-500">
            One dot per county at its actual value. Vertical rules are the six
            equal-count colour bins, which is why they crowd where the counties
            crowd.
          </p>
        </div>

        <div className="text-xs text-gray-700">
          <p className="mb-1.5 flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true">
              <rect width="14" height="14" fill={NO_DATA} />
              <line x1="0" y1="14" x2="14" y2="0" stroke="#b9b2a8" strokeWidth="2" />
            </svg>
            No practitioners recorded ({noData}{' '}
            {noData === 1 ? 'county' : 'counties'})
          </p>
          <p className="mb-1.5 flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="#08519c" fillOpacity="0.55" stroke="#08519c" />
            </svg>
            Organization an endpoint reaches
          </p>
          <p className="flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke={SIGNAL} strokeWidth="1.5" />
            </svg>
            Organization nothing public reaches
          </p>
          <p className="mt-1.5 text-gray-500">Circle area is practitioner count.</p>
        </div>
      </div>

      <p className="measure mt-4 text-xs text-gray-500">
        {geo.note} {geo.county_assignment.zips_spanning_more_than_one_county} ZIP
        codes in this state cross a county line and are assigned to the county
        holding most of their population;{' '}
        {geo.county_assignment.zips_where_dominant_county_holds_under_75_pct} of
        those are close enough to be genuinely ambiguous.{' '}
        {geo.county_assignment.practitioners_with_unmatched_postal_code.toLocaleString(
          'en-US',
        )}{' '}
        practitioners carry a postal code with no county match and are absent
        from the county layer.{' '}
        {geo.point_layer.organizations_without_any_geocoded_site.toLocaleString(
          'en-US',
        )}{' '}
        organizations hold practitioners but publish no geocoded location, so
        they are counted everywhere else on this page and cannot be drawn here.
      </p>
    </div>
  );
}
