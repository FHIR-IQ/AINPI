import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'A third of American hospitals serve a seventh of the population';

export default async function Image() {
  return renderOgCard({
    eyebrow: 'Rural health · National baseline',
    title: 'A third of American hospitals serve a seventh of the population',
    stats: [
      { value: '34.4%', label: 'Hospitals nonmetro' },
      { value: '13.8%', label: 'Residents nonmetro' },
      { value: '1,338', label: 'Critical Access' },
    ],
  });
}
