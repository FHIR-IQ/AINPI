import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/reports/2026-05-update.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'AINPI May 2026 update — H26, H27, and SMD-letter readiness',
  description:
    'Subscriber update covering H27 (SSN exposure in NDH bulk export — independent verification of the 2026-04-30 Washington Post finding), H26 (VA payer-directory exposure across 4 carriers), the Virginia State Medicaid briefing, and the high-risk cohort v0.4.0 closing 3 of 4 § 455.436 federal database checks.',
  openGraph: {
    title: 'AINPI May 2026 update',
    description:
      'H27 SSN exposure (63 confirmed), H26 VA payer-directory exposure (4 of 125 in Cigna), and the Virginia DMAS briefing for 2026-05-04.',
    url: 'https://ainpi.dev/reports/2026-05-update',
    type: 'article',
  },
};

export default function May2026UpdatePage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'AINPI May 2026 update')}
      sourceHref={GITHUB_URL}
    />
  );
}
