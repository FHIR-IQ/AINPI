'use client';

import { useState } from 'react';
import SubstackSignupForm from './SubstackSignupForm';
import { NEWSLETTER_NAME } from '@/lib/newsletter';

interface InlineSubscribeProps {
  /**
   * Persisted to Subscriber.source so per-surface conversion is measurable
   * in the admin report. Use a distinct value per placement, e.g.
   * 'finding_page', 'landscape_panel'.
   */
  source: string;
  /** One-line pitch above the input. Keep it plain. */
  prompt?: string;
}

/**
 * Compact email-capture strip for content pages. Submits to Substack's free
 * sign-up in a new tab, so the reader keeps their place in the article; the
 * source tag is recorded on ainpi.dev on the way (see lib/newsletter.ts).
 */
export default function InlineSubscribe({
  source,
  prompt = `Get new findings in ${NEWSLETTER_NAME}, the free newsletter on Substack that also carries the podcast and essays.`,
}: InlineSubscribeProps) {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
        Substack opened in a new tab to finish your sign-up.
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
      <p className="text-sm text-gray-700 mb-2">{prompt}</p>
      <SubstackSignupForm
        source={source}
        newTab
        onSubmitted={() => setSent(true)}
        formClassName="flex gap-2 flex-wrap"
        inputClassName="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        buttonClassName="px-4 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
      />
    </div>
  );
}
