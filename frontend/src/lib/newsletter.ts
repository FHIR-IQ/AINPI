/**
 * The one newsletter list.
 *
 * AINPI, fhiriq.com and eugenevestel.com all send readers to the same
 * Substack publication, FHIR IQ Playbook. AINPI findings go out there
 * alongside the Out of the FHIR podcast and essays, so form copy must not
 * promise "AINPI only" or "one email per release".
 *
 * Substack has no public API for adding a subscriber, so a sign-up here is
 * stored in the `subscribers` table (source attribution, admin alert) and
 * the reader confirms on Substack. Until they confirm, they get nothing.
 */
export const SUBSTACK_URL = 'https://evestel.substack.com';
export const NEWSLETTER_NAME = 'FHIR IQ Playbook';

/** Substack's subscribe page with the address filled in. */
export function substackSubscribeUrl(email?: string): string {
  const base = `${SUBSTACK_URL}/subscribe`;
  const trimmed = email?.trim();
  return trimmed ? `${base}?email=${encodeURIComponent(trimmed)}` : base;
}
