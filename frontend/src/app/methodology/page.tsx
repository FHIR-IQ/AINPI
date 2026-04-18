import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';

export const dynamic = 'force-static';

const METHODOLOGY_PATH = path.join(process.cwd(), '..', 'docs', 'methodology', 'index.md');

function coerceToStrings(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
    } else if (v == null) {
      out[k] = '';
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

function loadMethodology(): { frontMatter: Record<string, string>; body: string } {
  try {
    const raw = fs.readFileSync(METHODOLOGY_PATH, 'utf8');
    const { data, content } = matter(raw);
    return { frontMatter: coerceToStrings(data as Record<string, unknown>), body: content };
  } catch {
    return {
      frontMatter: { title: 'AINPI methodology', version: 'missing', status: 'not-found' },
      body: '> Methodology document not found on disk. See `docs/methodology/index.md`.',
    };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { frontMatter } = loadMethodology();
  const title = frontMatter.title || 'AINPI methodology';
  const description = 'Reproducible, versioned methodology for auditing the CMS National Provider Directory — data sources, DAMA DMBOK mapping, validation pipeline, referential integrity, endpoint liveness (L0–L7), identity correctness, and temporal analysis.';
  return {
    title: `${title} — AINPI`,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      url: 'https://ainpi.vercel.app/methodology',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function MethodologyPage() {
  const { frontMatter, body } = loadMethodology();
  const version = frontMatter.version || 'unknown';
  const status = frontMatter.status || 'draft';
  const lastUpdated = frontMatter.last_updated || '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 text-white px-2.5 py-1 font-mono">
            v{version}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 font-medium capitalize">
            {status}
          </span>
          {lastUpdated && (
            <span className="text-gray-500">updated {lastUpdated}</span>
          )}
        </div>
        <article className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-primary-600 prose-code:font-mono prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
        <footer className="mt-16 pt-8 border-t text-sm text-gray-500">
          <p>
            Source: <a className="text-primary-600 hover:underline" href="https://github.com/FHIR-IQ/AINPI/blob/main/docs/methodology/index.md">docs/methodology/index.md</a>
          </p>
          <p className="mt-1">
            Cite this work: see <a className="text-primary-600 hover:underline" href="https://github.com/FHIR-IQ/AINPI/blob/main/CITATION.cff">CITATION.cff</a>.
          </p>
        </footer>
      </main>
    </div>
  );
}
