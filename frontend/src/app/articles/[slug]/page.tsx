import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import fs from 'node:fs';
import path from 'node:path';
import Navbar from '@/components/Navbar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadMarkdown } from '@/lib/load-markdown';

export const dynamic = 'force-static';

const ARTICLES_DIR = path.join(process.cwd(), '..', 'docs', 'articles');

function slugToFile(slug: string): string | null {
  if (!fs.existsSync(ARTICLES_DIR)) return null;
  for (const name of fs.readdirSync(ARTICLES_DIR)) {
    if (!name.endsWith('.md')) continue;
    if (name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '') === slug) {
      return path.join('docs', 'articles', name);
    }
    if (name.replace(/\.md$/, '') === slug) {
      return path.join('docs', 'articles', name);
    }
  }
  return null;
}

export function generateStaticParams(): { slug: string }[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((n) => ({ slug: n.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '') }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const docPath = slugToFile(slug);
  if (!docPath) return { title: 'Article — AINPI' };
  const doc = loadMarkdown(docPath, 'AINPI article');
  // Pull the first H1 as the title.
  const titleMatch = doc.body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'AINPI article';
  return {
    title,
    description: doc.body
      .split('\n')
      .find((line) => line.trim() && !line.startsWith('#') && !line.startsWith('*'))
      ?.slice(0, 200),
    openGraph: {
      title,
      url: `https://ainpi.dev/articles/${slug}`,
      type: 'article',
    },
  };
}

// Hardcoded GitHub directory link for the article source. The per-article
// filename is intentionally NOT interpolated into the href — CodeQL's
// stored-XSS analysis flags any filesystem-derived value flowing into an
// anchor href even when (a) the route is statically generated via
// generateStaticParams, (b) the slug is validated by slugToFile, and
// (c) React escapes JSX. Static href is unambiguously safe.
const ARTICLES_GITHUB_URL =
  'https://github.com/FHIR-IQ/AINPI/tree/main/docs/articles';

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const docPath = slugToFile(slug);
  if (!docPath) notFound();
  const doc = loadMarkdown(docPath, 'AINPI article');

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <article className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-primary-600 prose-code:font-mono prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.body}</ReactMarkdown>
        </article>
        <footer className="mt-16 pt-8 border-t text-sm text-gray-500 flex flex-wrap gap-4 items-center justify-between">
          <p>
            <a
              className="text-primary-600 hover:underline"
              href={ARTICLES_GITHUB_URL}
            >
              View source on GitHub →
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
