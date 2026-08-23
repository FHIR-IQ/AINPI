/**
 * Structured data emitters.
 *
 * The highest-value one here is Dataset. AINPI publishes open, versioned,
 * downloadable payloads with stated methodology and provenance, which is
 * exactly what Google Dataset Search indexes, and almost nothing in the
 * health-data-quality space is registered there. Article and Organization
 * carry the ordinary publication signals.
 *
 * Values are serialised with JSON.stringify and injected as a script of type
 * application/ld+json. Angle brackets are escaped so a stray character in a
 * finding title cannot break out of the script element.
 */

const SITE = 'https://ainpi.dev';

function LdScript({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      // The payload is built from our own typed data, never user input.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export function OrganizationJsonLd() {
  return (
    <LdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'AINPI',
        url: SITE,
        description:
          'An open, reproducible audit of the CMS National Provider Directory.',
        sameAs: ['https://github.com/FHIR-IQ/AINPI'],
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <LdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'AINPI',
        url: SITE,
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/npd?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      }}
    />
  );
}

const REPO = 'https://github.com/FHIR-IQ/AINPI';

/**
 * One-line descriptions for the upstream datasets named in `isBasedOn`.
 *
 * WHY THIS EXISTS
 *
 * Search Console reported "Missing field description" against this site's
 * Dataset markup. The top-level Dataset always carried one. The nested nodes
 * did not: `isBasedOn` emitted `{'@type': 'Dataset', name, url}`, and Google
 * validates every node typed Dataset, not only the root. Four nested nodes on
 * a findings page meant four errors.
 *
 * Keyed by URL rather than name because the URL is the stable identifier and
 * the display name has been reworded more than once. The fallback below means
 * a source added later cannot silently reintroduce the error.
 */
const SOURCE_DESCRIPTIONS: Record<string, string> = {
  'https://directory.cms.gov/':
    'The CMS National Provider Directory bulk FHIR R4 export, covering Practitioner, PractitionerRole, Organization, Location, Endpoint and related resources.',
  'https://download.cms.gov/nppes/NPI_Files.html':
    'The federal National Plan and Provider Enumeration System registry of every issued National Provider Identifier and its self-attested taxonomy and address.',
  'https://data.cms.gov/provider-data/dataset/mj5m-pzi6':
    'CMS Provider Data Catalog file listing Medicare-enrolled clinicians with their group practice affiliations, specialties and practice addresses.',
  'https://data.cms.gov/provider-data/dataset/xubh-q36u':
    'CMS Provider Data Catalog file listing every Medicare-certified hospital in the United States with its address, ownership and county.',
  'https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment':
    'CMS Medicare enrollment file linking individual providers to the group practices they reassign their billing rights to.',
  'https://github.com/Enterprise-CMCS/SMA-Endpoint-Directory':
    'CMS-maintained index of state Medicaid agency provider-directory API endpoints, one row per jurisdiction.',
  'https://providerdirectory-api.capbluecross.com/r4':
    'A payer provider-directory FHIR R4 API published under the CMS Interoperability and Patient Access rule (CMS-9115-F).',
  'https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40':
    'The National Uniform Claim Committee code set classifying provider type, specialty and subspecialty for every National Provider Identifier.',
  'https://www.census.gov/programs-surveys/popest.html':
    'US Census Bureau county population estimates and the ZCTA-to-county relationship file, used to attach geography to provider records.',
  'https://www.ers.usda.gov/data-products/rural-urban-continuum-codes/':
    'USDA Economic Research Service codes classifying each US county on a continuum from metropolitan to completely rural.',
};

/** Every node typed Dataset needs a description, including nested ones. */
function sourceDescription(s: { name: string; url: string; description?: string }): string {
  return (
    s.description ??
    SOURCE_DESCRIPTIONS[s.url] ??
    `Upstream public dataset used as a source for this AINPI finding: ${s.name}.`
  );
}


export function DatasetJsonLd({
  name,
  description,
  url,
  distributionUrls,
  dateModified,
  keywords,
  measurementTechnique,
  variableMeasured,
  version,
  temporalCoverage,
  spatialCoverage = 'United States',
  basedOn = {
    name: 'CMS National Provider Directory public use files',
    url: 'https://directory.cms.gov/',
  },
}: {
  name: string;
  /** Google requires 50 characters or more, else the dataset is dropped. */
  description: string;
  url: string;
  /** Direct links to the machine-readable payloads. */
  distributionUrls: { url: string; format: 'application/json' | 'text/csv' }[];
  dateModified?: string;
  keywords?: string[];
  measurementTechnique?: string;
  /** What the dataset counts: its denominator, stated in words. */
  variableMeasured?: string;
  /** Methodology version the numbers were produced under. */
  version?: string;
  /** The source release the numbers describe, not the day we published them. */
  temporalCoverage?: string;
  spatialCoverage?: string;
  /**
   * Upstream source(s), for datasets not derived from the NDH bulk files.
   * Accepts a list, because a finding can legitimately derive from more than
   * one: H52 joins a payer FHIR directory to the NDH, and naming only one of
   * them misattributes provenance.
   */
  basedOn?:
    | { name: string; url: string; description?: string }
    | { name: string; url: string; description?: string }[];
}) {
  const abs = (u: string) => (u.startsWith('http') ? u : `${SITE}${u}`);
  const sources = Array.isArray(basedOn) ? basedOn : [basedOn];

  return (
    <LdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name,
        description,
        url: abs(url),
        // Google wants a stable handle. This project has no DOI, so the
        // canonical page URL is the only persistent identifier available.
        identifier: abs(url),
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        isAccessibleForFree: true,
        creator: { '@type': 'Organization', name: 'AINPI', url: SITE },
        publisher: { '@type': 'Organization', name: 'AINPI', url: SITE },
        sameAs: REPO,
        includedInDataCatalog: {
          '@type': 'DataCatalog',
          name: 'AINPI public API',
          url: `${SITE}/developer`,
        },
        // citation is a reference to another work, not a description of the
        // denominator. The denominator belongs in variableMeasured.
        citation: {
          '@type': 'CreativeWork',
          name: 'AINPI audit methodology',
          url: `${SITE}/methodology`,
        },
        spatialCoverage,
        ...(version ? { version } : {}),
        ...(temporalCoverage ? { temporalCoverage } : {}),
        ...(variableMeasured ? { variableMeasured } : {}),
        ...(dateModified ? { dateModified } : {}),
        ...(keywords?.length ? { keywords } : {}),
        ...(measurementTechnique ? { measurementTechnique } : {}),
        distribution: distributionUrls.map((d) => ({
          '@type': 'DataDownload',
          encodingFormat: d.format,
          contentUrl: abs(d.url),
        })),
        isBasedOn: sources.map((s) => ({
          '@type': 'Dataset',
          ...s,
          description: sourceDescription(s),
        })),
      }}
    />
  );
}

export function ArticleJsonLd({
  headline,
  description,
  url,
  datePublished,
  dateModified,
}: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
}) {
  return (
    <LdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline,
        description,
        url: url.startsWith('http') ? url : `${SITE}${url}`,
        datePublished,
        dateModified: dateModified ?? datePublished,
        author: { '@type': 'Organization', name: 'AINPI', url: SITE },
        publisher: { '@type': 'Organization', name: 'AINPI', url: SITE },
        isAccessibleForFree: true,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url.startsWith('http') ? url : `${SITE}${url}` },
      }}
    />
  );
}
