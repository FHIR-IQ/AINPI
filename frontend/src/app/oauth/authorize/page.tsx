import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { checkAuthorize, redirectWith, ISSUER } from '@/lib/oauth';
import { loadClient } from '@/lib/oauth-client';

/**
 * /oauth/authorize: the sign-in step of OAuth for the AINPI MCP server.
 * The user pastes an AINPI API key (from the trial email or a plan); the form
 * posts to /api/oauth/authorize, which checks it and sends the user back to
 * the application with a one-time code.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in to AINPI tools', robots: { index: false, follow: false } };

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const PASSED = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'];

export default async function AuthorizePage({ searchParams }: { searchParams: Search }) {
  const q: Record<string, string | undefined> = {};
  for (const k of PASSED) q[k] = first(searchParams[k]);
  const client = await loadClient(q.client_id);
  const check = checkAuthorize(q, client);
  if (!check.ok && check.redirect) {
    redirect(redirectWith(check.redirectUri, { error: check.error, error_description: check.description, state: check.state, iss: ISSUER }));
  }
  const badKey = first(searchParams.error) === 'bad_key';
  const host = check.ok ? new URL(check.params.redirectUri).host || check.params.redirectUri : '';

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="mx-auto max-w-lg px-4 py-12 sm:px-6">
        <p className="eyebrow m-0">Sign in</p>
        <h1 className="m-0 mt-2 font-serif text-3xl text-ink">Connect to AINPI tools</h1>
        {!check.ok ? (
          <p role="alert" className="mt-6 text-sm text-signal">
            {check.description} Start the connection again from your application.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm text-gray-700">
              An application{client?.clientName ? <> calling itself <strong>{client.clientName}</strong></> : null} wants to use the
              AINPI tools as you. It will return to <code className="font-mono text-xs">{host}</code>. Approve only if you started
              this connection.
            </p>
            <form method="post" action="/api/oauth/authorize" className="mt-6 space-y-4 text-sm">
              {PASSED.map((k) => (q[k] !== undefined ? <input key={k} type="hidden" name={k} value={q[k]} /> : null))}
              <label className="block">
                <span className="mb-1 block font-medium text-ink">Your AINPI API key</span>
                <input
                  type="password"
                  name="api_key"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ainpi_live_..."
                  className="w-full rounded-sm border border-gray-300 bg-white px-3 py-2 font-mono text-ink focus:outline-none focus:ring-2 focus:ring-primary-600"
                />
              </label>
              {badKey && (
                <p role="alert" className="text-signal">
                  That key was not recognised, or it has been revoked or has expired.
                </p>
              )}
              <p className="text-xs text-gray-600">
                The key is in the email you got when you started a trial or a plan. It is checked once and never shared with
                the application, which gets a separate token that stops working if the key is revoked or expires. No key
                yet? <a href="/trial" className="text-primary-600 underline underline-offset-2">Start a 14-day trial</a>.
              </p>
              <div className="flex gap-3">
                <button type="submit" name="action" value="allow" className="rounded-sm bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700">
                  Allow
                </button>
                <button type="submit" name="action" value="cancel" formNoValidate className="rounded-sm border border-gray-300 px-4 py-2 text-ink hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
