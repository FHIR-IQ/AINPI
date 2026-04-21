import type { Metadata } from 'next';
import MarkdownPage from '@/components/MarkdownPage';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const DOC_PATH = 'docs/methodology/index.md';
const GITHUB_URL = `https://github.com/FHIR-IQ/AINPI/blob/main/${DOC_PATH}`;

export async function generateMetadata(): Promise<Metadata> {
  const { frontMatter } = loadMarkdown(DOC_PATH, 'AINPI methodology');
  const title = frontMatter.title || 'AINPI methodology';
  const description =
    'Reproducible, versioned methodology for auditing the CMS National Provider Directory — data sources, DAMA DMBOK mapping, validation pipeline, referential integrity, endpoint liveness (L0–L7), identity correctness, and temporal analysis.';
  return {
    title: `${title} — AINPI`,
    description,
    openGraph: { title, description, type: 'article', url: 'https://ainpi.vercel.app/methodology' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function MethodologyPage() {
  return (
    <MarkdownPage
      doc={loadMarkdown(DOC_PATH, 'AINPI methodology')}
      sourceHref={GITHUB_URL}
    />
  );
}
