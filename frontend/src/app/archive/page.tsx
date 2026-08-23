import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/archive.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'The release archive',
  description:
    'CMS serves only the current version of the federal provider directory. We keep the earlier ones. 54 million rows across two releases, free, partitioned so you can diff them.',
  openGraph: {
    title: 'The release archive | AINPI',
    description:
      'Every published version of the federal provider directory, including the ones CMS no longer serves.',
    url: 'https://ainpi.dev/archive',
    type: 'article',
  },
};

export default function ArchivePage() {
  return (
    <MarkdownPage doc={loadMarkdown(DOC_PATH, 'The release archive')} sourceHref={GITHUB_URL} />
  );
}
