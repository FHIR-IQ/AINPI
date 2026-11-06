'use client';

import { Suspense, createContext, useContext, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AinpiLink, Network, NetworkSource, NetworkType, NetworksPayload, UseCaseSlug } from '@/lib/api-v1-types';
import {
  DEFAULT_USE_CASE,
  JURISDICTIONS,
  STALE_AFTER_DAYS,
  isStale,
  networksForRoute,
  networksInState,
  oldestCheck,
  parseUseCase,
  resolveAinpiLink,
  safeExternalHref,
  routesFor,
  stateCategory,
  type Overlays,
  type StateCategory,
} from '@/lib/networks';
import { STATE_NAMES } from '@/components/charts/network-map-style';

// D3 stays out of SSR; the map fetches its topology on the client.
const NetworkStateMap = dynamic(() => import('@/components/charts/NetworkStateMap'), {
  ssr: false,
  loading: () => <div className="aspect-[960/560] w-full border border-gray-200 bg-gray-100" aria-hidden="true" />,
});

export interface NetworksClientProps {
  payload: NetworksPayload;
  /** Build date, YYYY-MM-DD, computed once on the server. Staleness is judged against it. */
  buildDate: string;
  /**
   * Slugs of published findings that networks.json links to, computed on the
   * server so the findings catalog stays out of the client bundle.
   */
  publishedSlugs: string[];
}

const PublishedContext = createContext<ReadonlySet<string>>(new Set());

const TYPE_LABEL: Record<NetworkType, string> = {
  state_hie: 'State HIE',
  multi_state: 'Multi-state network',
  qhin: 'QHIN',
  vendor_network: 'Vendor network',
  payer_api: 'Payer API',
  direct: 'Direct',
};

export const DISCLAIMER =
  'Educational resource, not legal advice and not an endorsement. AINPI is independent; no network, state agency or CMS reviewed or produced this page. Confirm details with the network before relying on them.';

function asOfDate(buildDate: string): Date {
  return new Date(`${buildDate}T00:00:00Z`);
}

/** An https link from the data file, or plain text when the URL fails `safeExternalHref`. */
function ExternalLink({ url, className, children }: { url: string; className: string; children: React.ReactNode }) {
  const href = safeExternalHref(url);
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function Sources({ sources }: { sources: NetworkSource[] }) {
  return (
    <ul className="m-0 list-none space-y-1 p-0 text-sm">
      {sources.map((s) => (
        <li key={s.url}>
          <ExternalLink url={s.url} className="text-primary-600 underline">
            {s.title}
          </ExternalLink>{' '}
          <span className="text-gray-500">(accessed {s.accessed})</span>
        </li>
      ))}
    </ul>
  );
}

function AinpiLinks({ links }: { links: AinpiLink[] }) {
  const published = useContext(PublishedContext);
  const resolved = links
    .map((l) => resolveAinpiLink(l, published))
    .filter((l): l is { label: string; href: string } => l !== null);
  if (resolved.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
      {resolved.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="text-primary-600 underline">
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NetworkItem({ n, asOf, tagPending = false }: { n: Network; asOf: Date; tagPending?: boolean }) {
  const stale = isStale(n.last_checked, asOf);
  return (
    <li data-testid={`network-${n.id}`} className="border-t border-gray-200 py-2 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <ExternalLink url={n.website} className="font-medium text-ink underline">
          <span className="font-medium text-ink">{n.name}</span>
        </ExternalLink>
        <span className="text-[11px] uppercase tracking-wider text-gray-500">{TYPE_LABEL[n.type]}</span>
        {tagPending && n.detail_level !== 'full' && (
          <span className="rounded-sm border border-gray-400 px-1.5 text-[11px] text-gray-600">use-case detail pending</span>
        )}
        {stale && (
          <span className="rounded-sm border border-signal px-1.5 text-[11px] font-medium text-signal">
            Needs re-check
          </span>
        )}
      </div>
      <p className="m-0 mt-1 text-sm text-gray-700">{n.how_to_join}</p>
      <p className="m-0 mt-1 text-xs text-gray-500">
        Last checked {n.last_checked}
        {n.sources.length > 0 && (
          <>
            {'. Source: '}
            {n.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ', '}
                <ExternalLink url={s.url} className="underline">
                  {s.title}
                </ExternalLink>
              </span>
            ))}
          </>
        )}
      </p>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="eyebrow m-0">{label}</h4>
      <p className="m-0 mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}

function StatePanel({
  payload,
  state,
  asOf,
  onClose,
}: {
  payload: NetworksPayload;
  state: string;
  asOf: Date;
  onClose: () => void;
}) {
  const { local, national } = networksInState(payload, state);
  const name = STATE_NAMES[state] ?? state;
  return (
    <section data-testid="state-panel" aria-labelledby="state-panel-title" className="mt-4 border-t-2 border-ink pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="state-panel-title" className="m-0 font-serif text-xl text-ink">
          {name}
        </h3>
        <button type="button" onClick={onClose} className="text-sm text-gray-600 underline hover:text-ink">
          Close
        </button>
      </div>
      <p className="m-0 mt-1 text-sm text-gray-600">Networks in our sources for this state, of every type. Other networks may operate here.</p>
      {local.length === 0 ? (
        <p className="m-0 mt-3 text-sm text-gray-700">
          No state or multi-state network found in our sources for this state.
        </p>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {local.map((n) => (
            <NetworkItem key={n.id} n={n} asOf={asOf} />
          ))}
        </ul>
      )}
      <h4 className="eyebrow m-0 mt-4">National networks and programs</h4>
      {national.length === 0 ? (
        <p className="m-0 mt-1 text-sm text-gray-700">No national network entries yet.</p>
      ) : (
        <ul className="m-0 mt-1 list-none p-0">
          {national.map((n) => (
            <NetworkItem key={n.id} n={n} asOf={asOf} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Reads `?use=` and syncs it into the explorer's selection. Kept in its own
 * Suspense boundary so the route can stay force-static: the static HTML shows
 * the default use case, and this child applies the query once on the client.
 * An unknown value falls back to the default.
 */
function UseCaseFromUrl({ onUse }: { onUse: (slug: UseCaseSlug) => void }) {
  const params = useSearchParams();
  const raw = params?.get('use') ?? undefined;
  useEffect(() => onUse(parseUseCase(raw)), [raw, onUse]);
  return null;
}

/**
 * The interactive body of /networks. Holds the selected use case in state,
 * starting at the default, and mirrors changes into `?use=` without a scroll.
 * Rendered once with the payload; `UseCaseFromUrl` applies the query.
 */
export default function NetworksClient({ payload, buildDate, publishedSlugs }: NetworksClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [useCase, setUseCase] = useState<UseCaseSlug>(DEFAULT_USE_CASE);
  const published = useMemo(() => new Set(publishedSlugs), [publishedSlugs]);
  const [overlays, setOverlays] = useState<Overlays>({ state_hie: true, multi_state: true });
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const asOf = useMemo(() => asOfDate(buildDate), [buildDate]);

  const current = payload.use_cases.find((u) => u.slug === useCase);
  const routes = routesFor(payload, useCase);

  const cells = useMemo(() => {
    const out: Record<string, { category: StateCategory; verified: boolean }> = {};
    for (const s of JURISDICTIONS) out[s] = stateCategory(payload, useCase, s, overlays);
    return out;
  }, [payload, useCase, overlays]);

  const sourceList = useMemo(() => {
    const seen = new Map<string, NetworkSource>();
    for (const r of payload.routes) for (const s of r.sources) if (!seen.has(s.url)) seen.set(s.url, s);
    for (const n of payload.networks) for (const s of n.sources) if (!seen.has(s.url)) seen.set(s.url, s);
    return [...seen.values()];
  }, [payload]);
  const oldest = oldestCheck(payload);

  function choose(slug: UseCaseSlug) {
    setUseCase(slug);
    router.replace(`${pathname}?use=${slug}`, { scroll: false });
  }

  return (
    <PublishedContext.Provider value={published}>
      <Suspense fallback={null}>
        <UseCaseFromUrl onUse={setUseCase} />
      </Suspense>
      <section aria-labelledby="use-case-label" className="mt-8">
        <p id="use-case-label" className="m-0 font-serif text-lg text-ink">
          I want to…
        </p>
        <div role="group" aria-labelledby="use-case-label" className="mt-3 flex flex-wrap gap-2">
          {payload.use_cases.map((u) => {
            const on = u.slug === useCase;
            return (
              <button
                key={u.slug}
                type="button"
                aria-pressed={on}
                onClick={() => choose(u.slug)}
                className={`rounded-sm border px-3 py-1.5 text-left text-sm transition-colors ${
                  on ? 'border-ink bg-ink text-paper' : 'border-gray-300 bg-paper text-gray-800 hover:border-ink'
                }`}
              >
                {u.label}
              </button>
            );
          })}
        </div>
        {current && (
          <div className="measure mt-4">
            <p className="m-0 text-gray-700">{current.summary}</p>
            {current.ainpi_links.length > 0 && (
              <div className="mt-2">
                <AinpiLinks links={current.ainpi_links} />
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
        <section data-testid="routes-panel" aria-labelledby="routes-title" className="min-w-0">
          <h2 id="routes-title" className="rule-heading font-serif text-xl text-ink">
            Routes
          </h2>
          {routes.length === 0 ? (
            <p className="m-0 text-sm text-gray-700">Route detail for this use case is being researched.</p>
          ) : (
            <div className="space-y-6">
              {routes.map((r) => {
                const nets = networksForRoute(payload, r.id, selectedState);
                return (
                  <article key={r.id} data-testid={`route-${r.id}`} className="border-t border-gray-300 pt-3">
                    <h3 className="m-0 font-serif text-lg text-ink">{r.title}</h3>
                    <p className="m-0 mt-1 text-sm text-gray-700">{r.summary}</p>
                    <div className="mt-3 space-y-3">
                      <Field label="Who can use it" value={r.who_can_use} />
                      <Field label="Rule" value={r.rule} />
                      <Field label="Standard" value={r.standard} />
                      <Field label="How to join" value={r.how_to_join} />
                      {r.ainpi_links.some((l) => resolveAinpiLink(l, published) !== null) && (
                        <div>
                          <h4 className="eyebrow m-0">On ainpi.dev</h4>
                          <div className="mt-1">
                            <AinpiLinks links={r.ainpi_links} />
                          </div>
                        </div>
                      )}
                      <div>
                        <h4 className="eyebrow m-0">Sources</h4>
                        <div className="mt-1">
                          <Sources sources={r.sources} />
                        </div>
                      </div>
                      {nets.length > 0 && (
                        <div>
                          <h4 className="eyebrow m-0">
                            {selectedState
                              ? `Networks for this route in ${STATE_NAMES[selectedState] ?? selectedState} and nationally`
                              : 'National networks for this route'}
                          </h4>
                          <ul className="m-0 mt-1 list-none p-0">
                            {nets.map((n) => (
                              <NetworkItem key={n.id} n={n} asOf={asOf} tagPending />
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="map-title" className="min-w-0">
          <h2 id="map-title" className="rule-heading font-serif text-xl text-ink">
            By state
          </h2>
          <fieldset className="m-0 mb-3 flex flex-wrap gap-x-5 gap-y-1 border-0 p-0 text-sm text-gray-800">
            <legend className="eyebrow mb-1 p-0">Show on the map</legend>
            {(['state_hie', 'multi_state'] as const).map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={overlays[t]}
                  onChange={(e) => setOverlays((o) => ({ ...o, [t]: e.target.checked }))}
                />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </fieldset>
          <NetworkStateMap
            cells={cells}
            selectedState={selectedState}
            onStateClick={(code: string) => setSelectedState((s) => (s === code ? null : code))}
            title={`States with a state or multi-state network in our sources: ${current?.label ?? useCase}`}
          />
          <p className="m-0 mt-2 text-xs text-gray-500">Select a state to list the networks in our sources for it.</p>
          {selectedState && (
            <StatePanel payload={payload} state={selectedState} asOf={asOf} onClose={() => setSelectedState(null)} />
          )}
        </section>
      </div>

      <section aria-labelledby="glossary-title" className="mt-12">
        <h2 id="glossary-title" className="rule-heading font-serif text-xl text-ink">
          Glossary
        </h2>
        <dl className="measure m-0 space-y-3">
          {payload.glossary.map((g) => (
            <div key={g.term}>
              <dt className="font-semibold text-ink">{g.term}</dt>
              <dd className="m-0 text-sm text-gray-700">{g.definition}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section data-testid="sources-freshness" aria-labelledby="sources-title" className="mt-12">
        <h2 id="sources-title" className="rule-heading font-serif text-xl text-ink">
          Sources and freshness
        </h2>
        <p className="measure m-0 text-sm text-gray-700">
          {oldest
            ? `Oldest last-checked date on this page: ${oldest}. Entries checked more than ${STALE_AFTER_DAYS} days before this page was built are marked "Needs re-check".`
            : 'No network entries have been checked yet.'}{' '}
          The full data file is at{' '}
          <a href="/api/v1/networks.json" className="text-primary-600 underline">
            /api/v1/networks.json
          </a>
          .
        </p>
        {sourceList.length > 0 && (
          <ul className="m-0 mt-3 list-none space-y-1 p-0 text-sm">
            {sourceList.map((s) => (
              <li key={s.url} className="break-words">
                <ExternalLink url={s.url} className="text-primary-600 underline">
                  {s.title}
                </ExternalLink>{' '}
                <span className="text-gray-500">(accessed {s.accessed})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 border-t border-gray-300 pt-3 text-sm text-gray-600">{DISCLAIMER}</p>
    </PublishedContext.Provider>
  );
}

