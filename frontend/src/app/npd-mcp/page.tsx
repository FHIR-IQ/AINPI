import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Navbar from '@/components/Navbar';
import { loadMarkdown } from '@/lib/load-markdown';
import { listPublicParticipants } from '@/lib/npd-mcp-participants';
import { orgTypeLabel } from '@/data/npd-mcp';
import SignupForm from './SignupForm';

/**
 * /npd-mcp: the NPD MCP working group. Renders docs/npd-mcp/tool-goals.md
 * (the same text sent to CMS, so there is one copy), the sign-up form, and the
 * organizations that chose to be listed.
 *
 * Re-rendered at most every 10 minutes, so a new listing appears without a
 * deploy and the database is read at most once per window. The doc must be
 * readable in the lambda for that: next.config.js traces it in.
 */
export const revalidate = 600;

const DOC_PATH = 'docs/npd-mcp/tool-goals.md';
const DESCRIPTION =
  'An open working group to implement and test MCP tools over National Provider Directory data, draft standards, and validate use cases. Sign up without an account.';

export const metadata: Metadata = {
  title: 'NPD MCP working group',
  description: DESCRIPTION,
  openGraph: {
    title: 'NPD MCP working group',
    description: DESCRIPTION,
    url: 'https://ainpi.dev/npd-mcp',
    type: 'website',
  },
};

export default async function NpdMcpPage() {
  const doc = loadMarkdown(DOC_PATH, 'NPD MCP working group');
  if (doc.frontMatter.version === 'missing') {
    // Throwing keeps the last good render when a revalidation cannot read the
    // doc, rather than replacing the page with a "not found" stub.
    throw new Error(`/npd-mcp: ${DOC_PATH} could not be read.`);
  }
  const participants = await listPublicParticipants();

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow m-0">Working group</p>
        <h1 className="m-0 mt-2 font-serif text-4xl text-ink">{doc.frontMatter.title}</h1>
        <p className="mt-3 text-xs text-gray-500">
          Version {doc.frontMatter.version} · updated {doc.frontMatter.updated}
        </p>
        <p className="mt-6">
          <a
            href="#join"
            className="inline-block rounded-sm border border-primary-600 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50"
          >
            Join the working group
          </a>
        </p>

        <article className="measure prose mt-8 [overflow-wrap:anywhere] prose-headings:font-serif prose-headings:font-normal prose-headings:text-ink prose-p:text-ink prose-a:text-primary-600 prose-strong:text-ink prose-code:font-mono prose-code:text-sm prose-table:text-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table>{children}</table>
                </div>
              ),
            }}
          >
            {doc.body}
          </ReactMarkdown>
        </article>

        <section id="join" className="mt-14 scroll-mt-20 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Join the working group</h2>
          <p className="measure mt-2 text-sm text-gray-600">
            No account is needed. Only your organization&apos;s name and type are ever shown on this page, and only if you tick the box.
          </p>
          <div className="mt-6">
            <SignupForm />
          </div>
        </section>

        <section className="mt-14 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Who has joined</h2>
          <p className="mt-2 text-sm text-gray-600">Organizations that asked to be listed.</p>
          {participants.length === 0 ? (
            <p className="mt-4 text-sm text-ink">Be the first to sign up.</p>
          ) : (
            <ul data-testid="participants" className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
              {participants.map((p, i) => (
                <li key={`${p.organization}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
                  <span className="text-ink">{p.organization}</span>
                  <span className="text-gray-500">{orgTypeLabel(p.orgType)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
