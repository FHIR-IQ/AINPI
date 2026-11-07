'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
import { ALL_STATE_NAMES } from '@/data/states';

// D3 stays out of SSR; the map fetches its topology on the client.
const NetworkStateMap = dynamic(() => import('@/components/charts/NetworkStateMap'), {
  ssr: false,
  loading: () => <div className="aspect-[960/560] w-full border border-gray-200 bg-gray-100" aria-hidden="true" />,
});

interface NetworksClientProps {
  payload: NetworksPayload;
  /** Build date, YYYY-MM-DD, computed once on the server. Staleness is judged against it. */
  buildDate: string;
  /**
   * Slugs of published findings that networks.json links to, computed on the
   * server so the findings catalog stays out of the client bundle.
   */
  publishedSlugs: string[];
}

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

function Sources({ sources, className = '' }: { sources: NetworkSource[]; className?: string }) {
  return (
    <ul className={`m-0 list-none space-y-1 p-0 text-sm ${className}`}>
      {sources.map((s) => (
        <li key={s.url} className="break-words">
          <ExternalLink url={s.url} className="text-primary-600 underline">
            {s.title}
          </ExternalLink>{' '}
          <span className="text-gray-500">(accessed {s.accessed})</span>
        </li>
      ))}
    </ul>
  );
}

/** Links to AINPI pages that resolve; renders nothing (heading included) when none do. */
function AinpiLinks({
  links,
  published,
  heading,
}: {
  links: AinpiLink[];
  published: ReadonlySet<string>;
  heading?: string;
}) {
  const resolved = links
    .map((l) => resolveAinpiLink(l, published))
    .filter((l): l is { label: string; href: string } => l !== null);
  if (resolved.length === 0) return null;
  const list = (
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
  if (!heading) return list;
  return (
    <div>
      <h4 className="eyebrow m-0">{heading}</h4>
      <div className="mt-1">{list}</div>
    </div>
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
  const name = ALL_STATE_NAMES[state] ?? state;
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

  // One row per URL. When two entries cite the same URL, show the latest
  // accessed date, so the list never reports an older check than a card does.
  const sourceList = useMemo(() => {
    const seen = new Map<string, NetworkSource>();
    for (const s of [...payload.routes, ...payload.networks].flatMap((x) => x.sources)) {
      const prev = seen.get(s.url);
      if (!prev || s.accessed > prev.accessed) seen.set(s.url, s);
    }
    return [...seen.values()];
  }, [payload]);
  const oldest = oldestCheck(payload);
  const stateOptions = useMemo(
    () => JURISDICTIONS.map((code) => ({ code, name: ALL_STATE_NAMES[code] ?? code })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  // Where focus was when a state was chosen (a map path or the picker), so
  // closing the panel can return it there instead of dropping it on <body>.
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null);
  const mapRegion = useRef<HTMLElement>(null);

  function selectState(code: string | null) {
    if (code !== null) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    }
    setSelectedState(code);
  }

  function closePanel() {
    setSelectedState(null);
    const target = returnFocus.current;
    if (target && target.isConnected && target !== document.body) target.focus();
    else mapRegion.current?.focus();
  }

  function choose(slug: UseCaseSlug) {
    setUseCase(slug);
    // Keep any other query parameters (utm_* and the like).
    const q = new URLSearchParams(window.location.search);
    q.set('use', slug);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <>
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
                <AinpiLinks links={current.ainpi_links} published={published} />
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
                      <AinpiLinks links={r.ainpi_links} published={published} heading="On ainpi.dev" />
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
                              ? `Networks for this route in ${ALL_STATE_NAMES[selectedState] ?? selectedState} and nationally`
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

        <section ref={mapRegion} tabIndex={-1} aria-labelledby="map-title" className="min-w-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
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
          <label className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-800">
            <span>Choose a state</span>
            <select
              data-testid="state-picker"
              value={selectedState ?? ''}
              onChange={(e) => selectState(e.target.value || null)}
              className="rounded-sm border border-gray-300 bg-paper px-2 py-1 text-sm text-ink"
            >
              <option value="">None selected</option>
              {stateOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <NetworkStateMap
            cells={cells}
            selectedState={selectedState}
            onStateClick={(code: string) => selectState(selectedState === code ? null : code)}
            title={`States with a state or multi-state network in our sources: ${current?.label ?? useCase}`}
          />
          <p className="m-0 mt-2 text-xs text-gray-500">Select a state on the map or in the list to see the networks in our sources for it.</p>
          <p className="sr-only" aria-live="polite">
            {selectedState ? `Showing networks for ${ALL_STATE_NAMES[selectedState] ?? selectedState} below the map.` : ''}
          </p>
          {selectedState && <StatePanel payload={payload} state={selectedState} asOf={asOf} onClose={closePanel} />}
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
        {sourceList.length > 0 && <Sources sources={sourceList} className="mt-3" />}
      </section>

      <p className="mt-10 border-t border-gray-300 pt-3 text-sm text-gray-600">{DISCLAIMER}</p>
    </>
  );
}

