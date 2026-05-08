import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-05-08-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'AINPI 2026-05-08 update — first comparable-release deltas',
  description:
    'CMS pushed a new NDH bulk export. AINPI re-ingested everything and reports release-to-release deltas: Endpoint −73%, Location −61%, OrgAffiliation +147%, SSN exposures 46 → 41, Org NPI duplicates 383K → 1.41M, plus two source-side schema breaks consumers should know about.',
  openGraph: {
    title: 'AINPI 2026-05-08 update — first comparable-release deltas',
    description:
      'Endpoint −73%, Location −61%, OrgAffiliation +147%. SSN exposures 46 → 41 (CMS partially scrubbed). Org NPI duplicates 383K → 1.41M.',
    url: 'https://ainpi.dev/reports/2026-05-08-update',
    type: 'article',
  },
};

export default function May2026Update0508Page() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'AINPI 2026-05-08 update')}
      sourceHref={GITHUB_URL}
    />
  );
}
