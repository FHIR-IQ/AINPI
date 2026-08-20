/**
 * People and organizations doing adjacent work on provider and payer directory
 * data, surfaced at /partners.
 *
 * Rules for adding an entry, because a links page decays faster than anything
 * else on a site:
 *
 *  - Every URL was opened and read. No link goes in from memory or from a
 *    search-result snippet.
 *  - Every `quote` is verbatim from the piece it cites. Paraphrase belongs in
 *    `why`, in our own voice, never inside quotation marks next to someone
 *    else's name. Misquoting a peer is worse than not quoting them.
 *  - `why` says what their work does that ours does not. A partners page that
 *    only says "great folks" is an advertisement; one that says where the
 *    other party is stronger is useful to a reader deciding who to read.
 *  - Listing someone here is not a claim of endorsement in either direction.
 *    The page says so in as many words.
 */
export interface PartnerLink {
  title: string;
  url: string;
  /** ISO date the piece was published, for ordering and staleness. */
  date: string;
  /** Verbatim, from the linked piece. Never a paraphrase. */
  quote?: string;
  /** Where this connects to something AINPI publishes. */
  relatedTo?: { label: string; href: string };
}

export interface Partner {
  name: string;
  person?: string;
  role?: string;
  url: string;
  what: string;
  /** What they cover that we do not. Written in our voice. */
  why: string;
  links: PartnerLink[];
}

export const PARTNERS: Partner[] = [
  {
    name: 'Defacto Health',
    person: 'Ron Urwongse',
    role: 'Co-founder',
    url: 'https://defacto.health/',
    what:
      'Payer network and provider directory data, with an accuracy scoring and monitoring service built on top of it.',
    why:
      'We audit the federal directory as published. Defacto works the payer side, which is the half of the problem the federal files do not cover, and has been tracking payer directory API behaviour since 2022. Where we measure what a file contains, they measure whether a patient could actually act on it.',
    links: [
      {
        title:
          'Swift Revalidation of High-Risk Medicaid Providers, National Directory, and Payer APIs',
        url: 'https://defacto.health/2026/07/03/swift-revalidation-of-high-risk-medicaid-providers-national-directory-and-payer-apis/',
        date: '2026-07-03',
        quote:
          'The value of compliant directory APIs for program integrity is not that directory errors are themselves evidence of fraud. What directory data provides is a map of which providers are enrolled in Medicaid.',
        relatedTo: {
          label: 'Our § 455.436 revalidation work',
          href: '/smd-revalidation',
        },
      },
      {
        title: 'REAL Health Providers Act: How should we measure accuracy?',
        url: 'https://defacto.health/2026/06/01/real-health-providers-act-how-should-we-measure-accuracy/',
        date: '2026-06-01',
        quote:
          'Directory accuracy is not defined simply by an attestation or by a contract. It is defined by whether a patient can find, book, and see a provider at the place and time the directory states.',
        relatedTo: {
          label: 'Our REAL Health Providers Act brief',
          href: '/real-health-providers',
        },
      },
      {
        title:
          'CMS-0062-P and What Mandatory Payer API Endpoint Reporting Means for Provider Directories',
        url: 'https://defacto.health/2026/04/17/cms-0062-p-and-what-mandatory-payer-api-endpoint-reporting-means-for-provider-directories/',
        date: '2026-04-17',
        relatedTo: {
          // Deliberately past tense and release-scoped. We measured zero payer
          // endpoints against 2026-05-08. CMS added InsurancePlan on
          // 2026-08-20, so the finding needs re-running before anyone reads it
          // as a claim about the current file.
          label: 'What we found against the May release',
          href: '/findings/ndh-payer-endpoint-coverage',
        },
      },
      {
        title: 'National Provider Directory Accuracy: July 2025 Report',
        url: 'https://defacto.health/2025/07/29/national-provider-directory-accuracy-july-2025-report/',
        date: '2025-07-29',
      },
      {
        title: 'State of Provider Directory APIs 2024',
        url: 'https://defacto.health/2024/06/24/state-of-provider-directory-apis-2024/',
        date: '2024-06-24',
      },
    ],
  },
  {
    name: 'Fasten Health',
    person: 'Jason Kulatunga',
    role: 'Founder',
    url: 'https://www.fastenhealth.com/',
    what:
      'A unified medical record API that connects to health systems on a patient’s behalf, plus an open-source personal health record.',
    why:
      'They consume this data rather than audit it, which makes them the best evidence of what actually breaks. Their catalogue is built on the SMART User Access Brands specification, so they hit the missing brand layer in the federal directory before anyone measuring the files would notice it.',
    links: [
      {
        title: 'Fasten Connect',
        url: 'https://www.fastenhealth.com/',
        date: '2026-08-18',
        relatedTo: {
          label: 'Why we recommend Brands as the spine, not the NDH',
          href: '/primer',
        },
      },
    ],
  },
];

/**
 * Places this work gets discussed, as opposed to people publishing research.
 *
 * Separate from PARTNERS on purpose. These are venues a reader can join, and
 * the useful field is how to get in, not what they published.
 *
 * `joinNote` is deliberately honest when we cannot publish a join path. The
 * CMS provider directory Slack and its weekly call are real, and we have been
 * in both, but neither publishes an open invite link we could verify. Printing
 * a guessed invite URL would be worse than saying to ask, because a dead
 * invite makes a reader think the community is dead.
 */
export interface Community {
  name: string;
  what: string;
  cadence?: string;
  /** Verified public URL, or null when there is no public landing page. */
  url: string | null;
  joinNote: string;
  links?: { label: string; url: string }[];
}

export const COMMUNITIES: Community[] = [
  {
    name: 'CMS Health Technology Ecosystem',
    what:
      'The CMS initiative the National Provider Directory sits inside, covering the interoperability framework and the patient-facing tools built on it.',
    url: 'https://www.cms.gov/initiatives/health-technology-ecosystem/overview',
    joinNote:
      'Public initiative page. CMS has run webinars and a request for information; watch the overview page for the current comment window.',
    links: [
      {
        label: 'One year on, CMS readout',
        url: 'https://www.cms.gov/newsroom/press-releases/readout-cms-celebrates-delivery-health-technology-ecosystem-one-year-after-launch',
      },
    ],
  },
  {
    name: 'CMS provider directory community',
    what:
      'The working group around the National Provider Directory itself: a Slack workspace and a recurring community call where the CMS directory team takes questions from implementers. Most of what this project has learned about intent, as opposed to contents, came from there.',
    cadence: 'Weekly call, plus an ongoing Slack workspace',
    url: 'https://directory.cms.gov/',
    joinNote:
      'There is no public invite link we can point at. Ask the CMS directory team through the bulk download site, or ask anyone already participating to bring you in.',
  },
  {
    name: 'HL7 Patient Administration',
    what:
      'The HL7 work group that owns the National Directory of Healthcare Providers and Services implementation guide, which is the specification the CMS files are built against.',
    // Points at the published IG rather than hl7.org/Special/committees/pafm.
    // That committee page sits behind bot protection and answers 202 with an
    // empty body, so we cannot confirm a reader would see anything. The IG
    // names the owning work group anyway. Do not "fix" this back to the
    // committee URL without checking it renders.
    url: 'https://hl7.org/fhir/us/ndh/STU1/',
    joinNote:
      'HL7 work groups are open to attend, and chat.fhir.org is where implementers actually argue about the guide. Cite the published STU1 rather than the continuous build: per its co-author the ballot and CI URLs are not stable references.',
    links: [
      { label: 'chat.fhir.org', url: 'https://chat.fhir.org/' },
      { label: 'NDH bulk downloads', url: 'https://directory.cms.gov/downloads' },
    ],
  },
];
