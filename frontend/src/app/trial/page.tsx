import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { TIERS } from '@/lib/rate-limit';
import { TRIAL_DAYS } from '@/lib/trial';
import TrialForm from './TrialForm';

/**
 * /trial: self-serve 14-day API trial. Static page; the form posts to
 * /api/v1/trial, which emails the key. No price is shown yet: conversion is a
 * conversation (reply to the emails, or the mailto below).
 */
export const dynamic = 'force-static';

const DESCRIPTION =
  'Start a free 14-day trial of the AINPI API and MCP server: higher limits on provider-directory search across the CMS National Provider Directory, NPPES and payer directories. No card needed.';

export const metadata: Metadata = {
  title: 'API trial',
  description: DESCRIPTION,
  openGraph: { title: 'AINPI API trial', description: DESCRIPTION, url: 'https://ainpi.dev/trial', type: 'website' },
};

const anon = TIERS.anonymous;
const trial = TIERS.trial;

export default function TrialPage() {
  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="eyebrow m-0">API trial</p>
        <h1 className="m-0 mt-2 font-serif text-4xl text-ink">Try the AINPI API for {TRIAL_DAYS} days</h1>
        <p className="lede measure mt-4">
          For teams that build on provider directory data: analytics firms, payer and market access teams, consultants and
          app developers. Your key arrives by email in about a minute. No card is needed.
        </p>

        <section className="mt-10 grid gap-6 sm:grid-cols-3">
          <div className="border-t border-gray-300 pt-3">
            <h2 className="m-0 text-base font-medium text-ink">Higher limits</h2>
            <p className="mt-1 text-sm text-gray-600">
              {(trial.perDay / anon.perDay).toFixed(0)} times the anonymous daily quota and{' '}
              {Math.floor(trial.perMinute / anon.perMinute)} times the per-minute rate on the search API.
            </p>
          </div>
          <div className="border-t border-gray-300 pt-3">
            <h2 className="m-0 text-base font-medium text-ink">Cross-source search</h2>
            <p className="mt-1 text-sm text-gray-600">
              One query across the CMS National Provider Directory, NPPES and four payer directories, with each source shown
              side by side.
            </p>
          </div>
          <div className="border-t border-gray-300 pt-3">
            <h2 className="m-0 text-base font-medium text-ink">MCP server</h2>
            <p className="mt-1 text-sm text-gray-600">
              Connect an AI agent to organization and endpoint lookup, NPI checks and the published findings.
            </p>
          </div>
        </section>

        <p className="measure mt-8 text-sm text-gray-600">
          The published findings and files under <code>/api/v1/</code> stay free with no key, during the trial and after.
          The trial covers the live search routes, which cost money to run. See the{' '}
          <Link href="/developer" className="text-primary-600 underline underline-offset-2">developer docs</Link> for every
          route.
        </p>

        <section id="start" className="mt-12 scroll-mt-20 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Start the trial</h2>
          <div className="mt-6">
            <TrialForm />
          </div>
        </section>

        <section className="mt-12 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">After the trial</h2>
          <p className="measure mt-2 text-sm text-gray-600">
            A plan has higher limits than the trial, keeps your key working when the daily spend ceiling pauses anonymous and
            trial traffic, and includes direct support. Pricing depends on volume:{' '}
            <a href="mailto:gene@fhiriq.com?subject=AINPI%20API%20plan" className="text-primary-600 underline underline-offset-2">
              email us
            </a>{' '}
            or reply to any trial email. Moving to a plan keeps the same key.
          </p>
        </section>

        <section id="terms" className="mt-12 scroll-mt-20 border-t border-gray-200 pt-8">
          <h2 className="m-0 font-serif text-2xl text-ink">Trial terms</h2>
          <ul className="measure mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
            <li>The trial lasts {TRIAL_DAYS} days from sign-up. After that the key returns 401 unless you move to a plan.</li>
            <li>
              If total daily use of the site passes its spend ceiling, trial keys are paused along with anonymous traffic
              until the next UTC day. Plan keys keep working.
            </li>
            <li>One trial per email address.</li>
            <li>Keep the key private. All use of it counts against your quota.</li>
            <li>
              AINPI is research on public CMS and federal data, provided as is with no service commitment during the trial.
              Verify any number against the primary source before acting on it.
            </li>
            <li>We may end a trial that is used to bulk-copy the data or to harm the service.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
