import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import {
  allConnectivityStates,
  loadStateConnectivity,
} from '@/lib/load-api-v1';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'AINPI provider connectivity ledger';

export function generateStaticParams() {
  return allConnectivityStates().map((state) => ({ state }));
}

const STATE_NAMES: Record<string, string> = {
  pa: 'Pennsylvania',
  va: 'Virginia',
  oh: 'Ohio',
};

/**
 * Share card for the connectivity ledger.
 *
 * Reads the same payload the page renders, so the card cannot drift from the
 * numbers underneath it. That has bitten this project before: a figure
 * corrected on the page kept shipping wrong somewhere else because the second
 * surface held its own copy.
 *
 * Both endpoint denominators go on the card. "19.3% reach an endpoint" alone
 * reads as a verdict on the whole state and hides that most practitioners
 * have no organization to route through; "50.3% of those with an affiliation"
 * alone hides the role gap. Shown together they are a summary. Shown apart
 * either one is a half-truth, and a share card is exactly where a half-truth
 * travels furthest.
 */
export default async function Image({
  params,
}: {
  params: { state: string };
}) {
  const payload = loadStateConnectivity(params.state);
  const s = payload?.summary;
  const name =
    payload?.state_name ??
    STATE_NAMES[params.state] ??
    params.state.toUpperCase();

  const stats = s
    ? [
        {
          value: `${s.reaches_endpoint_pct}%`,
          label: 'Reach an endpoint',
        },
        {
          value: `${s.reaches_endpoint_pct_of_affiliated}%`,
          label: 'Of those with an affiliation',
        },
        {
          value: s.practitioners.toLocaleString('en-US'),
          label: 'Practitioners traced',
        },
      ]
    : undefined;

  return renderOgCard({
    eyebrow: `${name} · Connectivity ledger`,
    title: 'Can software actually reach your clinician?',
    stats,
  });
}
