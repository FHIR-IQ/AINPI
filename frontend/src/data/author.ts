/**
 * Single source of truth for author identity.
 *
 * Used by AuthorByline (state pages, finding pages, report PDF) and any
 * place we need a citation-ready author block. Editing the credentials
 * line below propagates to every page that uses <AuthorByline />.
 */

export const AUTHOR = {
  name: 'Eugene Vestel',
  shortAffiliation: 'FHIR IQ',
  /** One-line professional credentials. Reviewed by author. */
  credentialsLine: 'Founder, FHIR IQ · Health interoperability consultant',
  links: {
    bio: 'https://eugenevestel.com',
    linkedin: 'https://www.linkedin.com/in/eugenevestel',
    email: 'gene@fhiriq.com',
    company: 'https://fhiriq.com',
  },
} as const;
