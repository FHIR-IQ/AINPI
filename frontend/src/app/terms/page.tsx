import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/terms.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'AINPI measures federal provider directory data. It is not a provider directory. Verify any record about a named provider against the primary sources before acting on it.',
  openGraph: {
    title: 'Terms of use | AINPI',
    description:
      'What AINPI is, what it is not, and why every signal needs primary-source verification before anyone acts on it.',
    url: 'https://ainpi.dev/terms',
    type: 'article',
  },
};

export default function TermsPage() {
  return (
    <MarkdownPage doc={loadMarkdown(DOC_PATH, 'Terms of use')} sourceHref={GITHUB_URL} />
  );
}
