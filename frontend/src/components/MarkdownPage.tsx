import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Navbar from '@/components/Navbar';
import type { MarkdownDoc } from '@/lib/load-markdown';

interface MarkdownPageProps {
  doc: MarkdownDoc;
  sourceHref: string;
  showVersionBadges?: boolean;
}

export default function MarkdownPage({
  doc,
  sourceHref,
  showVersionBadges = true,
}: MarkdownPageProps) {
  const { frontMatter, body } = doc;
  const version = frontMatter.version;
  const status = frontMatter.status;
  const lastUpdated = frontMatter.last_updated;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {showVersionBadges && (version || status || lastUpdated) && (
          <div className="mb-8 flex flex-wrap items-center gap-2 text-xs">
            {version && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 text-white px-2.5 py-1 font-mono">
                v{version}
              </span>
            )}
            {status && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 font-medium capitalize">
                {status}
              </span>
            )}
            {lastUpdated && (
              <span className="text-gray-500">updated {lastUpdated}</span>
            )}
          </div>
        )}
        <article className="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-primary-600 prose-code:font-mono prose-code:text-sm prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
        <footer className="mt-16 pt-8 border-t text-sm text-gray-500">
          <p>
            Source:{' '}
            <a className="text-primary-600 hover:underline" href={sourceHref}>
              {sourceHref.replace(/^https:\/\/github\.com\/FHIR-IQ\/AINPI\/blob\/main\//, '')}
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
