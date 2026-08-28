'use client';

import { useMemo, useState } from 'react';
import type { SpecialtyByOrgCase } from '@/lib/load-api-v1';

/**
 * Browser over practitioners whose recorded specialty differs by organization.
 *
 * The whole point of this page is that the difference is visible at a glance,
 * so each case renders as one person with their organizations stacked under
 * them, not as a table of rows a reader has to reassemble mentally.
 *
 * Two rows can legitimately carry the same organization name and different
 * specialties, because the directory publishes more than one Organization
 * record for one organization. Without the NPI printed under the name that
 * reads as a rendering bug, so it is always shown.
 */
const PAGE = 30;

function matches(c: SpecialtyByOrgCase, q: string): boolean {
  if (!q) return true;
  const haystack = [
    c.npi,
    c.name,
    c.state ?? '',
    ...c.orgs.flatMap((o) => [o.org, o.org_npi ?? '', ...o.specialties]),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export default function SpecialtyByOrgBrowser({
  cases,
}: {
  cases: SpecialtyByOrgCase[];
}) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => cases.filter((c) => matches(c, q)), [cases, q]);
  const visible = results.slice(0, shown);

  return (
    <div>
      <label htmlFor="q" className="eyebrow block mb-2">
        Search by name, NPI, state, organization or specialty
      </label>
      <input
        id="q"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShown(PAGE);
        }}
        placeholder="try: hospitalist, or 1871883355, or a health system name"
        className="w-full border border-ink/20 rounded-[3px] bg-white px-3 py-2 text-ink
                   placeholder:text-ink/40 focus:outline-none focus:border-primary-600"
      />

      <p className="mt-3 text-sm text-ink/60">
        {results.length.toLocaleString()} of {cases.length.toLocaleString()} example
        {results.length === 1 ? '' : 's'}
        {q ? ' matching' : ''}
      </p>

      <ul className="mt-6 space-y-4">
        {visible.map((c) => (
          <li key={c.npi} className="border border-ink/15 rounded-[3px] bg-white p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-serif text-lg text-ink">{c.name}</h3>
              <span className="font-mono text-xs text-ink/60">NPI {c.npi}</span>
              {c.state ? (
                <span className="text-xs text-ink/60">{c.state}</span>
              ) : null}
            </div>

            <ul className="mt-3 space-y-2">
              {c.orgs.map((o, i) => (
                <li
                  key={`${c.npi}-${i}`}
                  className="border-t border-ink/10 pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="text-sm text-ink">{o.org}</div>
                  <div className="font-mono text-[11px] text-ink/50">
                    {o.org_npi ? `NPI ${o.org_npi}` : 'no organization NPI published'}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {o.specialties.map((s) => (
                      <span
                        key={s}
                        className="border border-primary-600/30 bg-primary-600/5
                                   rounded-[2px] px-1.5 py-0.5 text-[11px] text-ink/80"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {results.length === 0 ? (
        <p className="mt-6 text-sm text-ink/60">
          Nothing matches that. These are {cases.length.toLocaleString()} sampled
          cases, not the whole directory, so a specific provider is unlikely to
          appear unless you picked them from this page.
        </p>
      ) : null}

      {shown < results.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-6 border border-ink/25 rounded-[3px] px-4 py-2 text-sm
                     text-ink hover:border-ink/50"
        >
          Show {Math.min(PAGE, results.length - shown)} more
        </button>
      ) : null}
    </div>
  );
}
