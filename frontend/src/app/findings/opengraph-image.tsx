import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'AINPI findings: pre-registered audits of federal provider data';

export default async function Image() {
  return renderOgCard({
    eyebrow: 'Findings · Pre-registered before the numbers land',
    title: 'Every claim states its null hypothesis and denominator first',
  });
}
