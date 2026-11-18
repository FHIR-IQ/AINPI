/**
 * The one newsletter list.
 *
 * AINPI, fhiriq.com and eugenevestel.com all send readers to the same
 * Substack publication, FHIR IQ Playbook. AINPI findings go out there
 * alongside the Out of the FHIR podcast and essays, so form copy must not
 * promise "AINPI only" or "one email per release".
 *
 * Sign-up forms post straight to Substack's free sign-up, the endpoint
 * Substack's own embed form uses. Its prefilled /subscribe page is not used:
 * it opens a plan picker with a paid plan preselected, and AINPI readers
 * come for free findings. The endpoint is not a documented API; if Substack
 * changes it, the fallback is SUBSTACK_SIGNUP_PAGE.
 *
 * Use the canonical domain. evestel.substack.com redirects here, and a
 * redirect turns the POST into a GET, which drops the email address.
 */
export const SUBSTACK_URL = 'https://newsletter.eugenevestel.com';
export const NEWSLETTER_NAME = 'FHIR IQ Playbook';

/** Form action for a free sign-up. Field: `email`. */
export const SUBSTACK_FREE_SIGNUP = `${SUBSTACK_URL}/api/v1/free?nojs=true`;

/** A free, email-only sign-up page, for links in email where a form cannot post. */
export const SUBSTACK_SIGNUP_PAGE = `${SUBSTACK_URL}/embed`;

/**
 * Record a sign-up for source attribution and the admin alert, without
 * delaying the form's own submission to Substack. sendBeacon survives the
 * navigation that follows; fetch with keepalive is the fallback.
 */
export function recordSignup(email: string, source: string): void {
  const body = JSON.stringify({ email: email.trim(), source });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.('/api/v1/subscribe', blob)) return;
  } catch {
    // fall through to fetch
  }
  void fetch('/api/v1/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
