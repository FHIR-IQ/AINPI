import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/data-license.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export const metadata: Metadata = {
  title: 'Data licence and attribution',
  description:
    'The federal source data is public domain and AINPI claims no rights over it. The code and the derived compilation are Apache-2.0. Attribution is requested so a quoted number stays traceable to its release.',
  openGraph: {
    title: 'Data licence and attribution | AINPI',
    description:
      'Public-domain federal sources, Apache-2.0 code and compilation, and how to cite a finding so it stays checkable.',
    url: 'https://ainpi.dev/data-license',
    type: 'article',
  },
};

export default function DataLicensePage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'Data licence and attribution')}
      sourceHref={GITHUB_URL}
    />
  );
}
