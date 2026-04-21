import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'SECURITY.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'Security policy — AINPI',
  description:
    'How to report security vulnerabilities in AINPI. 48-hour acknowledgement, coordinated disclosure.',
  openGraph: {
    title: 'Security policy — AINPI',
    description: 'Report vulnerabilities to gene@fhiriq.com; see the disclosure SLA.',
    url: 'https://ainpi.vercel.app/security',
    type: 'article',
  },
};

export default function SecurityPage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'Security policy')}
      sourceHref={GITHUB_URL}
    />
  );
}
