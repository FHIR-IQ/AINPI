import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/briefings/2026-05-04-virginia-state-medicaid.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'Virginia case study — AINPI',
  description:
    'Worked example using public federal data: Virginia provider directory data quality, the Virginia-resident federally-excluded cohort, and the H26 payer-directory exposure finding. Independent public-good research from AINPI.',
  openGraph: {
    title: 'Virginia case study — AINPI',
    description:
      'Worked example using public federal data: Virginia provider directory data quality, the federally-excluded cohort, and the H26 payer-directory exposure finding.',
    url: 'https://ainpi.dev/briefings/va',
    type: 'article',
  },
};

export default function VaBriefingPage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'Virginia case study')}
      sourceHref={GITHUB_URL}
    />
  );
}
