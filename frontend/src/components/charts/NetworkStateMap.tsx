'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { StateCategory } from '@/lib/networks';
import { cellStyle, FIPS_TO_STATE, LEGEND, PATTERNS, STATE_NAMES, type PatternDef } from './network-map-style';

export interface NetworkStateMapProps {
  cells: Record<string, { category: StateCategory; verified: boolean }>;
  selectedState: string | null;
  onStateClick: (code: string) => void;
  title: string;
}

const W = 960;
const H = 560;

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
  const idBase = useRef(`nsm-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    let live = true;
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
      .then((r) => r.json())
      .then((t) => live && setTopo(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  let features: any[] = [];
  let mesh = '';
  if (topo) {
    const geo = topojson.feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection;
    const projection = d3.geoAlbersUsa().fitSize([W, H], geo);
    const path = d3.geoPath().projection(projection);
    features = geo.features.map((f: any) => ({
      code: FIPS_TO_STATE[String(f.id).padStart(2, '0')] as string | undefined,
      d: path(f) ?? '',
    }));
    mesh = path(topojson.mesh(topo, topo.objects.states, (a: any, b: any) => a !== b) as any) ?? '';
  }

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
        <g>
          {features.map(({ code, d }, i) => {
            const st = cellStyle(code ?? '', code ? cells[code] : undefined);
            const selected = code === selectedState;
            const interactive = !!code && st.label !== 'Not covered';
            const name = code ? STATE_NAMES[code] ?? code : 'Territory';
            return (
              <path
                key={code ?? i}
                d={d}
                fill={st.patternId ? `url(#${st.patternId})` : st.fill}
                stroke={selected ? '#171310' : '#faf8f5'}
                strokeWidth={selected ? 1.5 : 0.5}
                vectorEffect="non-scaling-stroke"
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                aria-label={`${name}: ${st.label}`}
                aria-pressed={interactive ? selected : undefined}
                style={{ cursor: interactive ? 'pointer' : 'default', outlineOffset: 1 }}
                onClick={interactive ? () => onStateClick(code!) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onStateClick(code!);
                        }
                      }
                    : undefined
                }
              />
            );
          })}
        </g>
        {mesh && <path d={mesh} fill="none" stroke="#8a8279" strokeWidth={0.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      </svg>
      <figcaption className="mt-3">
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm text-ink">
          {LEGEND.map((e) => (
            <li key={e.key} className="flex items-center gap-2">
              {e.key !== 'national' && (
                <svg width={18} height={14} aria-hidden="true">
                  <rect
                    width={18}
                    height={14}
                    fill={e.style.patternId ? `url(#${e.style.patternId})` : e.style.fill}
                    stroke="#8a8279"
                    strokeWidth={0.5}
                  />
                </svg>
              )}
              <span>{e.label}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
