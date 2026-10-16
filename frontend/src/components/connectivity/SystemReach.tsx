import type {
  ConnectivityCorrection,
  ConnectivityPayload,
  ConnectivitySystem,
  EndpointBasis,
  SystemReachTier,
} from '@/lib/connectivity-types';

/** Plain-language tier names, strongest first. */
export const TIER_LABELS: Record<SystemReachTier, string> = {
  ndh: 'NDH',
  'vendor-npi': 'vendor NPI',
  // A sourced alias names this organization; a practice-wide list names
  // everyone in the practice, so the alias ranks first (FHI-73).
  alias: 'curated alias',
  'vendor-npi-list': 'vendor NPI list',
  'name-state': 'name match',
  'brand-state': 'brand match',
  'cms-enrollment-own-endpoint': 'CMS enrollment',
};

const TIER_ORDER = Object.keys(TIER_LABELS) as SystemReachTier[];
const DETERMINISTIC: SystemReachTier[] = ['ndh', 'vendor-npi'];

/**
 * True for a resolved tier that is inference rather than a deterministic
 * link (everything but `ndh` and `vendor-npi`); false for those two and for
 * no tier at all.
 */
export function isInferredTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  return (tier in TIER_LABELS) && !DETERMINISTIC.includes(tier as SystemReachTier);
}

/**
 * Human label for an organization's endpoint basis. A vendor-NPI basis with
 * a known count reads "vendor list (N NPIs)" or "vendor NPI (N NPIs on
 * URL)", so a practice-wide list is visible as one.
 */
export function basisLabel(
  basis: EndpointBasis | string | null | undefined,
  npisOnUrl?: number | null,
): string | null {
  if (!basis) return null;
  const n = typeof npisOnUrl === 'number' ? npisOnUrl : null;
  if (basis === 'vendor-npi-list') {
    return n !== null ? `vendor list (${fmt(n)} NPIs)` : 'vendor list';
  }
  if (basis === 'vendor-npi') {
    return n !== null && n > 1 ? `vendor NPI (${fmt(n)} NPIs on URL)` : 'vendor NPI';
  }
  if (basis === 'name-candidate') return 'name candidate, not a link';
  return TIER_LABELS[basis as SystemReachTier] ?? basis;
}

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

/**
 * True when the row counts distinct clinicians. Payloads written before
 * FHI-73 summed member counts into `practitioners` and carry no
 * `practitioner_org_links`.
 */
export function countsDistinct(row: ConnectivitySystem): boolean {
  return typeof row.practitioner_org_links === 'number';
}

/** Non-zero tiers of a row's reach, strongest first. */
export function reachParts(
  row: ConnectivitySystem,
): { tier: SystemReachTier; label: string; count: number; inferred: boolean }[] {
  const byTier = row.reach_by_tier;
  if (!byTier) return [];
  return TIER_ORDER.filter((t) => (byTier[t] ?? 0) > 0).map((t) => ({
    tier: t,
    label: TIER_LABELS[t],
    count: byTier[t],
    inferred: !DETERMINISTIC.includes(t),
  }));
}

/**
 * The "Reach" cell: distinct clinicians reaching an endpoint through the
 * system, split by tier so a lower-confidence tier is never folded into one
 * number. Renders a dash for payloads that predate per-tier reach.
 */
export function SystemReachCell({ row }: { row: ConnectivitySystem }) {
  if (typeof row.reaches_endpoint !== 'number') {
    return <span className="text-gray-500">&mdash;</span>;
  }
  if (row.reaches_endpoint === 0) {
    return <span className="text-signal">0</span>;
  }
  const parts = reachParts(row);
  const det = row.reaches_endpoint_deterministic;
  return (
    <span>
      <span className="font-mono">{fmt(row.reaches_endpoint)}</span>
      {typeof det === 'number' && (
        <span className="ml-1 text-xs text-gray-600">
          ({fmt(det)} NDH or vendor NPI)
        </span>
      )}
      <span className="block text-xs text-gray-600">
        {parts.map((p, i) => (
          <span key={p.tier}>
            {i > 0 ? ', ' : ''}
            {p.label} {fmt(p.count)}
            {p.inferred ? '*' : ''}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Split of an endpoint count into deterministic and inferred parts, or null
 * for payloads that predate `endpoint_count_deterministic` (whose
 * `endpoint_count` only counted deterministic tiers).
 */
export function endpointSplit(
  row: ConnectivitySystem,
): { deterministic: number; inferred: number } | null {
  if (typeof row.endpoint_count_deterministic !== 'number') return null;
  return {
    deterministic: row.endpoint_count_deterministic,
    inferred: Math.max(0, row.endpoint_count - row.endpoint_count_deterministic),
  };
}

/**
 * The "Endpoints" cell. With per-tier counts it reads "{deterministic} +
 * {inferred}*", so an endpoint reached only by name or brand inference is
 * never shown as if the directory stated it. The star is explained in the
 * tier note above the table.
 */
export function EndpointCountCell({ row }: { row: ConnectivitySystem }) {
  const split = endpointSplit(row);
  if (!split) {
    return row.endpoint_count === 0 ? (
      <span className="text-signal">0</span>
    ) : (
      <span>{fmt(row.endpoint_count)}</span>
    );
  }
  if (split.deterministic === 0 && split.inferred === 0) {
    return <span className="text-signal">0</span>;
  }
  return (
    <span>
      <span className={split.deterministic === 0 ? 'text-signal' : undefined}>
        {fmt(split.deterministic)}
      </span>
      {split.inferred > 0 && <> + {fmt(split.inferred)}*</>}
    </span>
  );
}

/**
 * Correction notice. Used above the systems table and, for the funnel-level
 * corrections, beside the headline. Renders nothing when absent.
 */
export function SystemsCorrections({
  corrections,
  title = 'Correction',
  testId = 'systems-corrections',
}: {
  corrections?: ConnectivityCorrection[];
  title?: string;
  testId?: string;
}) {
  if (!corrections || corrections.length === 0) return null;
  return (
    <div
      className="measure mb-6 border border-signal bg-white p-4 text-sm"
      data-testid={testId}
    >
      <p className="mb-2 font-medium text-ink">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-gray-700">
        {corrections.map((c) => (
          <li key={c.what}>
            {c.what} <span className="text-gray-500">Affected since {c.since}.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type UnreachedRows = NonNullable<
  ConnectivityPayload['systems']['known_systems_unreached']
>;

/**
 * Known systems whose own-domain endpoint no member organization's route
 * reaches (the Jefferson row on the PA slice), with what CMS enrollment
 * reaches instead. Renders nothing when there are none.
 */
export function KnownSystemsUnreached({ block }: { block?: UnreachedRows }) {
  if (!block || block.rows.length === 0) return null;
  return (
    <div
      className="measure mb-6 border border-gray-300 bg-white p-4 text-sm"
      data-testid="known-systems-unreached"
    >
      <p className="mb-2 font-medium text-ink">
        Known systems no member organization reaches
      </p>
      <p className="mb-3 text-gray-700">{block.note}</p>
      <table className="min-w-full text-xs">
        <thead className="border-b border-gray-200 text-left">
          <tr>
            <th className="py-1 pr-4 font-medium text-gray-700">System</th>
            <th className="py-1 pr-4 font-medium text-gray-700">Own domain</th>
            <th className="py-1 pr-4 text-right font-medium text-gray-700">
              Through members
            </th>
            <th className="py-1 pr-4 text-right font-medium text-gray-700">
              Through CMS enrollment only
            </th>
            <th className="py-1 font-medium text-gray-700">Via</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r) => (
            <tr key={r.system} className="border-b border-gray-100 last:border-0 align-top">
              <td className="py-1 pr-4 text-ink">{r.system}</td>
              <td className="py-1 pr-4 font-mono">{r.domains.join(', ')}</td>
              <td className="py-1 pr-4 text-right font-mono text-signal">
                {fmt(r.reached_through_member_tiers ?? 0)}
              </td>
              <td className="py-1 pr-4 text-right font-mono">
                {fmt(r.reached_through_enrollment_only ?? 0)}*
              </td>
              <td className="py-1 text-gray-700">{(r.via ?? []).join('; ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {block.rows.map((r) =>
        r.listed_reason ? (
          <p key={`${r.system}-why`} className="mt-2 text-xs text-gray-600">
            {r.system}: {r.listed_reason}
          </p>
        ) : null,
      )}
    </div>
  );
}
