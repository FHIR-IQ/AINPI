import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/privacy.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'Privacy policy — AINPI',
  description:
    'AINPI collects no analytics and sets no tracking cookies. Email is collected only when you explicitly submit a form.',
  openGraph: {
    title: 'Privacy policy — AINPI',
    description: 'How AINPI handles your data: none, unless you ask us to.',
    url: 'https://ainpi.vercel.app/privacy',
    type: 'article',
  },
};

export default function PrivacyPage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'Privacy policy')}
      sourceHref={GITHUB_URL}
    />
  );
}
