import { isInferredTier } from '@/components/connectivity/SystemReach';

/** Primary-600, the darkest step of the map ramp. */
export const POINT_BLUE = '#08519c';
/** The project's signal red, for an organization nothing public reaches. */
export const POINT_SIGNAL = '#a8321c';
/** Dash and gap length, in screen pixels at zoom 1. */
export const INFERRED_DASH = 2.4;

/**
 * Organization point style on the county map. Deterministic routes (the NDH,
 * or a vendor NPI on a URL listing 10 or fewer) are filled; inferred ones
 * (curated alias, vendor NPI on a practice-wide list, name or brand match)
 * are a hollow dashed ring in the same blue; no route is a hollow solid
 * signal ring. Filled versus hollow and dashed versus solid carry the
 * distinction without relying on hue, so it survives greyscale and colour
 * blindness.
 */
export function pointStyle(tier: string | null | undefined): {
  fill: string;
  stroke: string;
  dashed: boolean;
} {
  if (!tier) return { fill: 'none', stroke: POINT_SIGNAL, dashed: false };
  if (isInferredTier(tier)) return { fill: 'none', stroke: POINT_BLUE, dashed: true };
  return { fill: POINT_BLUE, stroke: POINT_BLUE, dashed: false };
}
