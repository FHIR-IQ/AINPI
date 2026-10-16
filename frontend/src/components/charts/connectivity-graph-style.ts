import type { ConnectivityGraph, SystemReachTier } from '@/lib/connectivity-types';

type Node = ConnectivityGraph['nodes'][number];
type Link = ConnectivityGraph['links'][number];

// `vendor-npi-list` (a vendor NPI on a practice-wide list) is deliberately
// absent: it is drawn as inference, dashed, like name and brand matches.
const DETERMINISTIC: SystemReachTier[] = ['ndh', 'vendor-npi'];

/**
 * Whether a system node is drawn filled. Filled means a deterministic tier
 * (NDH or vendor NPI) reaches it (FHI-73). Payloads without
 * `connected_deterministic` predate per-tier reach and fall back to
 * `connected`, which in those files only counted the deterministic tiers.
 */
export function systemFilled(n: Node): boolean {
  return Boolean(n.connected_deterministic ?? n.connected);
}

/** Reached only through inferred tiers: hollow, but not the unconnected ring. */
export function systemInferredOnly(n: Node): boolean {
  return Boolean(n.connected) && !systemFilled(n);
}

/** True for a `reaches` link whose tier is inference. */
export function linkInferred(l: Pick<Link, 'kind' | 'tier'>): boolean {
  return l.kind === 'reaches' && !!l.tier && !DETERMINISTIC.includes(l.tier);
}

/** SVG dash pattern: vendor links dotted, inferred reaches dashed. */
export function linkDash(l: Pick<Link, 'kind' | 'tier'>): string | null {
  if (l.kind === 'served-by') return '3 3';
  return linkInferred(l) ? '6 3' : null;
}
