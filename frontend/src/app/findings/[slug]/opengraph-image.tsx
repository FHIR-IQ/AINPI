import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';
import { findBySlug, allSlugs } from '@/data/findings';
import { loadFinding } from '@/lib/load-api-v1';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'AINPI finding';

export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }));
}

export default async function Image({ params }: { params: { slug: string } }) {
  const f = findBySlug(params.slug);
  const data = loadFinding(params.slug);

  // Prefer the published numerator/denominator, because a share card that
  // carries the actual measurement is the whole argument of the finding.
  // typeof rather than a null check: these fields come back undefined on
  // null-result findings (H42 reports numerator 0 with no denominator), and
  // `!== null` lets undefined straight through to .toLocaleString().
  // Denominator must also be non-zero before it can divide.
  const n = data?.numerator;
  const d = data?.denominator;
  const stats =
    typeof n === 'number' && typeof d === 'number' && d > 0
      ? [
          { value: `${Math.round((n / d) * 100)}%`, label: 'Of the denominator' },
          { value: n.toLocaleString(), label: 'Numerator' },
          { value: d.toLocaleString(), label: 'Denominator' },
        ]
      : undefined;

  return renderOgCard({
    eyebrow: `${(f?.hypotheses ?? []).join(', ') || 'Finding'} · ${
      f?.status === 'published' ? 'Published' : 'Pre-registered'
    }`,
    title: f?.ogTagline ?? f?.title ?? 'AINPI finding',
    stats,
  });
}
