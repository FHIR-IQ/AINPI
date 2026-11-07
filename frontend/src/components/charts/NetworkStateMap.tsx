'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { StateCategory } from '@/lib/networks';
import { ALL_STATE_NAMES } from '@/data/states';
import { FIPS_TO_STATE } from './fips';
import { cellStyle, legendFor, NATIONAL_NOTE, PATTERNS, type PatternDef } from './network-map-style';

interface NetworkStateMapProps {
  cells: Record<string, { category: StateCategory; verified: boolean }>;
  selectedState: string | null;
  onStateClick: (code: string) => void;
  title: string;
}

const W = 960;
const H = 560;
/** Inset so the outlines of edge states (Maine, Florida, Washington) are not clipped by the viewBox. */
const INSET = 4;

function PatternMarks({ p }: { p: PatternDef }) {
  const s = p.size;
  if (p.kind === 'dots') return <circle cx={s / 2} cy={s / 2} r={1} fill={p.mark} />;
  const lines = <path d={`M0 ${s} L${s} 0`} stroke={p.mark} strokeWidth={1} />;
  if (p.kind === 'lines') return lines;
  return (
    <>
      {lines}
      <path d={`M0 0 L${s} ${s}`} stroke={p.mark} strokeWidth={1} />
    </>
  );
}

function Defs() {
  return (
    <defs>
      {PATTERNS.map((p) => (
        <pattern key={p.id} id={p.id} width={p.size} height={p.size} patternUnits="userSpaceOnUse">
          <rect width={p.size} height={p.size} fill={p.background} />
          <PatternMarks p={p} />
        </pattern>
      ))}
    </defs>
  );
}

export default function NetworkStateMap({ cells, selectedState, onStateClick, title }: NetworkStateMapProps) {
  const [topo, setTopo] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const idBase = useRef(`nsm-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    let live = true;
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json')
      .then((r) => {
        if (!r.ok) throw new Error(`topology request failed: ${r.status}`);
        return r.json();
      })
      .then((t) => live && setTopo(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const { features, mesh } = useMemo(() => {
    if (!topo) return { features: [] as { code: string; d: string }[], mesh: '' };
    const geo = topojson.feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection;
    const projection = d3.geoAlbersUsa().fitExtent(
      [
        [INSET, INSET],
        [W - INSET, H - INSET],
      ],
      geo,
    );
    const path = d3.geoPath().projection(projection);
    return {
      // Territories fall outside geoAlbersUsa and FIPS_TO_STATE; skip them
      // rather than render empty or unlabelled elements.
      features: geo.features
        .map((f: any) => ({
          code: FIPS_TO_STATE[String(f.id).padStart(2, '0')] as string | undefined,
          d: path(f) ?? '',
        }))
        .filter((f): f is { code: string; d: string } => f.code !== undefined && f.d !== ''),
      mesh: path(topojson.mesh(topo, topo.objects.states, (a: any, b: any) => a !== b) as any) ?? '',
    };
  }, [topo]);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        aria-labelledby={`${idBase}-title`}
      >
        <title id={`${idBase}-title`}>{title}</title>
        <Defs />
        {failed && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={14} fill="#171310">
            The map could not be loaded.
          </text>
        )}
        {!failed && !topo && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={14} fill="#8a8279">
            Loading map
          </text>
        )}
        <g>
          {features.map(({ code, d }) => {
            const st = cellStyle(cells[code] ?? { category: 'none', verified: true });
            return (
              <path
                key={code}
                data-code={code}
                d={d}
                fill={st.patternId ? `url(#${st.patternId})` : st.fill}
                stroke="#faf8f5"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
                tabIndex={0}
                role="button"
                aria-label={`${ALL_STATE_NAMES[code] ?? code}: ${st.label}`}
                aria-pressed={code === selectedState}
                style={{ cursor: 'pointer', outline: 'none' }}
                onFocus={() => setFocused(code)}
                onBlur={() => setFocused((f) => (f === code ? null : f))}
                onClick={() => onStateClick(code)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onStateClick(code);
                  }
                }}
              />
            );
          })}
        </g>
        {mesh && <path d={mesh} fill="none" stroke="#8a8279" strokeWidth={0.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        {/* Outlines last so neighbours and the mesh never paint over them. Non-interactive. */}
        <g data-testid="outline-layer" pointerEvents="none" aria-hidden="true" fill="none">
          {features
            .filter((f) => f.code === selectedState || f.code === focused)
            .map((f) => (
              <path
                key={f.code}
                data-outline={f.code === selectedState ? 'selected' : 'focus'}
                d={f.d}
                stroke={f.code === selectedState ? '#171310' : '#a8321c'}
                strokeWidth={f.code === selectedState ? 1.5 : 2}
                strokeDasharray={f.code === selectedState ? undefined : '4 2'}
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </g>
      </svg>
      <figcaption className="mt-3">
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm text-ink">
          {legendFor(cells).map((e) => (
            <li key={e.key} className="flex items-center gap-2">
              <svg width={18} height={14} aria-hidden="true">
                <rect
                  width={18}
                  height={14}
                  fill={e.style.patternId ? `url(#${e.style.patternId})` : e.style.fill}
                  stroke="#8a8279"
                  strokeWidth={0.5}
                />
              </svg>
              <span>{e.label}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 text-sm text-ink">{NATIONAL_NOTE}</p>
      </figcaption>
    </figure>
  );
}
