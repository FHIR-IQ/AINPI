import type {
  ConnectivityCorrection,
  ConnectivitySystem,
  SystemReachTier,
} from '@/lib/connectivity-types';

/** Plain-language tier names, strongest first. */
export const TIER_LABELS: Record<SystemReachTier, string> = {
  ndh: 'NDH',
  'vendor-npi': 'vendor NPI',
  alias: 'curated alias',
  'name-state': 'name match',
  'brand-state': 'brand match',
  'cms-enrollment-own-endpoint': 'CMS enrollment',
};

const TIER_ORDER = Object.keys(TIER_LABELS) as SystemReachTier[];
const DETERMINISTIC: SystemReachTier[] = ['ndh', 'vendor-npi'];

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
  return (
    <span>
      <span className="font-mono">{fmt(row.reaches_endpoint)}</span>
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

/** Correction notice above the systems table. Renders nothing when absent. */
export function SystemsCorrections({
  corrections,
}: {
  corrections?: ConnectivityCorrection[];
}) {
  if (!corrections || corrections.length === 0) return null;
  return (
    <div
      className="measure mb-6 border border-signal bg-white p-4 text-sm"
      data-testid="systems-corrections"
    >
      <p className="mb-2 font-medium text-ink">Correction</p>
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
