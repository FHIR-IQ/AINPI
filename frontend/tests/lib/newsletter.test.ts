import { describe, expect, it } from 'vitest';
import {
  SUBSTACK_FREE_SIGNUP,
  SUBSTACK_SIGNUP_PAGE,
  SUBSTACK_URL,
} from '@/lib/newsletter';

describe('newsletter targets', () => {
  it('uses the canonical domain, so the POST is not redirected', () => {
    // evestel.substack.com 301s to this domain, and a redirect turns the
    // form's POST into a GET that drops the email address.
    expect(SUBSTACK_URL).toBe('https://newsletter.eugenevestel.com');
  });

  it('posts to the free sign-up, not the paid plan picker', () => {
    expect(SUBSTACK_FREE_SIGNUP).toBe(`${SUBSTACK_URL}/api/v1/free?nojs=true`);
    expect(SUBSTACK_FREE_SIGNUP).not.toContain('/subscribe');
    expect(SUBSTACK_SIGNUP_PAGE).toBe(`${SUBSTACK_URL}/embed`);
  });
});
