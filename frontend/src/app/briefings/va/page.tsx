import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/briefings/2026-05-04-virginia-state-medicaid.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'Virginia State Medicaid briefing — AINPI',
  description:
    'AINPI briefing for the Virginia Department of Medical Assistance Services on provider directory data quality, the federally excluded VA cohort, and the H26 payer-directory exposure finding. Prepared for the 2026-05-04 review meeting.',
  openGraph: {
    title: 'Virginia State Medicaid briefing — AINPI',
    description:
      'AINPI briefing for Virginia DMAS: provider directory data quality, the federally excluded VA cohort, and the H26 payer-directory exposure finding.',
    url: 'https://ainpi.dev/briefings/va',
    type: 'article',
  },
};

export default function VaBriefingPage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'Virginia State Medicaid briefing')}
      sourceHref={GITHUB_URL}
    />
  );
}
