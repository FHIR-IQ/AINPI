import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'AINPI: an open audit of the federal provider directory';

export default async function Image() {
  return renderOgCard({
    eyebrow: 'Open audit · CMS National Provider Directory',
    title: 'Where the federal provider directory is accurate, and where it is not',
    stats: [
      { value: '21.7M', label: 'FHIR records audited' },
      { value: '31', label: 'Pre-registered findings' },
      { value: 'Free', label: 'Public and reproducible' },
    ],
  });
}
