import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/faq.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'FAQ — AINPI',
  description:
    'Frequently asked questions about AINPI, the open-source audit of the CMS National Provider Directory: what it is, who built it, data sources, refresh cadence, contribution paths, and licensing.',
  openGraph: {
    title: 'FAQ — AINPI',
    description: 'Frequently asked questions about AINPI, the open-source CMS NPD audit.',
    url: 'https://ainpi.vercel.app/faq',
    type: 'article',
  },
};

export default function FaqPage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'Frequently asked questions')}
      sourceHref={GITHUB_URL}
    />
  );
}
