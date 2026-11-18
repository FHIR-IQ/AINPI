'use client';

import { useState } from 'react';
import { SUBSTACK_FREE_SIGNUP, recordSignup } from '@/lib/newsletter';

/**
 * The form itself is Substack's free sign-up: the browser submits it natively,
 * so it counts as the reader's own action and is never blocked as a popup.
 * Before it goes, recordSignup() logs the address and source on ainpi.dev.
 *
 * newTab: inline placements sit mid-article, so they open Substack in a new
 * tab and keep the reader's place. The /subscribe page submits in place.
 */
export default function SubstackSignupForm({
  source,
  id,
  newTab = false,
  inputClassName,
  buttonClassName,
  formClassName,
  buttonLabel = 'Subscribe',
  onSubmitted,
}: {
  source: string;
  id?: string;
  newTab?: boolean;
  inputClassName?: string;
  buttonClassName?: string;
  formClassName?: string;
  buttonLabel?: string;
  onSubmitted?: () => void;
}) {
  const [email, setEmail] = useState('');

  return (
    <form
      action={SUBSTACK_FREE_SIGNUP}
      method="post"
      target={newTab ? '_blank' : undefined}
      className={formClassName}
      onSubmit={() => {
        recordSignup(email, source);
        // Deferred: a state change that unmounts this form during the submit
        // event can cancel the native submission.
        if (onSubmitted) setTimeout(onSubmitted, 0);
      }}
    >
      <input type="hidden" name="source" value="embed" />
      <input
        id={id}
        type="email"
        name="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        autoComplete="email"
        className={inputClassName}
      />
      <button type="submit" disabled={!email} className={buttonClassName}>
        {buttonLabel}
      </button>
    </form>
  );
}
