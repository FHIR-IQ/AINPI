import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Navbar from '@/components/Navbar';
import { TOOL_GOALS_DOC } from '@/lib/npd-mcp-doc';
import { listPublicParticipants } from '@/lib/npd-mcp-participants';
import { orgTypeLabel } from '@/data/npd-mcp';
import SignupForm from './SignupForm';

/**
 * /npd-mcp: the NPD MCP working group. Renders docs/npd-mcp/tool-goals.md
 * (the same text sent to CMS, so there is one copy), the sign-up form, and the
 * organizations that chose to be listed.
 *
 * Re-rendered at most every 10 minutes, so a new listing appears without a
 * deploy and the database is read at most once per window. The doc is bundled
 * as text at build time (src/lib/npd-mcp-doc.ts), so a re-render reads no
 * file.
 */
export const revalidate = 600;

// The typography plugin colours prose with its own cool gray. Point every
// prose colour at the site's warm tokens (ink, primary.600, the gray ramp in
// tailwind.config.ts) so the table rules and inline code match the page.
const PROSE_TOKENS = [
  '[--tw-prose-body:theme(colors.ink)]',
  '[--tw-prose-headings:theme(colors.ink)]',
  '[--tw-prose-bold:theme(colors.ink)]',
  '[--tw-prose-code:theme(colors.ink)]',
  '[--tw-prose-links:theme(colors.primary.600)]',
  '[--tw-prose-th-borders:theme(colors.gray.300)]',
  '[--tw-prose-td-borders:theme(colors.gray.200)]',
  '[--tw-prose-hr:theme(colors.gray.200)]',
  '[--tw-prose-quotes:theme(colors.gray.700)]',
  '[--tw-prose-quote-borders:theme(colors.gray.200)]',
  '[--tw-prose-counters:theme(colors.gray.500)]',
  '[--tw-prose-bullets:theme(colors.gray.400)]',
].join(' ');
const DESCRIPTION =
  'An independent, open-source AINPI working group to implement and test MCP tools over National Provider Directory data. Not affiliated with CMS. Sign up without an account.';

export const metadata: Metadata = {
  // The root layout's title template appends " | AINPI", so the page title
  // carries the name once. The Open Graph title is not templated.
  title: 'NPD MCP working group',
  description: DESCRIPTION,
  openGraph: {
    title: 'NPD MCP working group (AINPI)',
    description: DESCRIPTION,
    url: 'https://ainpi.dev/npd-mcp',
    type: 'website',
  },
};

export default async function NpdMcpPage() {
  const doc = TOOL_GOALS_DOC;
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

        <article className={`measure prose mt-8 [overflow-wrap:anywhere] prose-headings:font-serif prose-headings:font-normal prose-code:font-mono prose-code:text-sm prose-table:text-sm ${PROSE_TOKENS}`}>
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

        <section id="test" className="mt-14 scroll-mt-20 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Test the tools</h2>
          <p className="measure mt-2 text-sm text-gray-600">
            The lookup tools are open to anyone. Reporting needs an API key, which is emailed to each organization after a check that its sign-up is genuine, because the key is what says which organization a report comes from.
          </p>
          <h3 className="mt-6 font-serif text-lg text-ink">Connect an MCP client</h3>
          <pre className="mt-2 overflow-x-auto rounded-sm border border-gray-200 bg-white p-3 font-mono text-xs text-ink">
            {`claude mcp add --transport http ainpi https://ainpi.dev/api/mcp \
  --header "Authorization: Bearer <your key>"`}
          </pre>
          <p className="measure mt-2 text-sm text-gray-600">
            Without a key, leave out the header. Tools: <code>search_organizations</code>, <code>lookup_organization</code>, <code>lookup_npi</code>, <code>check_npi_cohort</code>, <code>report_interaction</code> and <code>get_interaction_report</code> (key required), plus the AINPI findings tools.
          </p>
          <h3 className="mt-6 font-serif text-lg text-ink">Report an exchange over HTTP</h3>
          <p className="measure mt-2 text-sm text-gray-600">
            The report sandbox follows the NPD Endpoint Feedback API proposal, version 0.2: the same body, issue codes, receipts and errors. Generate a new UUID v4 for each <code>reportId</code> and reuse it on retry. Reports are visible only to your organization and are deleted after 90 days. Use test exchanges only, and never put patient data, credentials or raw payloads in a report.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-sm border border-gray-200 bg-white p-3 font-mono text-xs text-ink">
            {`curl -X POST https://ainpi.dev/api/v1/interaction-reports \
  -H "X-API-Key: <your key>" -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": "1.0",
    "reportId": "<new UUID v4>",
    "reporterRole": "requester",
    "endpointReference": "Endpoint/<id from the NDH>",
    "interaction": {
      "startedAt": "<RFC 3339 UTC time>",
      "endedAt": "<RFC 3339 UTC time>",
      "httpMethod": "GET",
      "httpStatus": 401
    },
    "outcome": "failure",
    "issues": [{
      "stage": "authentication",
      "code": "credentials-rejected",
      "severity": "error"
    }]
  }'`}
          </pre>
          <p className="measure mt-2 text-sm text-gray-600">
            A new report returns <code>201</code> with a receipt. Sending the same report again returns <code>200</code> and the original receipt; the same <code>reportId</code> with different content returns <code>409</code>. Read a receipt back with <code>GET /api/v1/interaction-reports/&lt;reportId&gt;</code>. This is a test service run by AINPI, not an NPD or CMS service.
          </p>
        </section>

        <section id="join" className="mt-14 scroll-mt-20 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Join the working group</h2>
          <p className="measure mt-2 text-sm text-gray-600">
            No account is needed. Only your organization&apos;s name and type are ever shown on this page, and only if you tick the box. A listing appears after a check that the sign-up is genuine.
          </p>
          <div className="mt-6">
            <SignupForm />
          </div>
        </section>

        <section className="mt-14 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Who has joined</h2>
          <p className="mt-2 text-sm text-gray-600">
            Organizations that asked to be listed, shown after a check. A listing means the organization signed up. It is not an endorsement.
          </p>
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
