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
 * The upstream datasets named in `isBasedOn`, with the fields Google checks.
 *
 * WHY THIS EXISTS
 *
 * Google validates every node typed Dataset, not only the root, and Search
 * Console has now said so twice. First "Missing field description": the root
 * always carried one and the nested nodes did not. Then "Missing field
 * creator" and "Missing field license", for the same reason. A findings page
 * naming four sources produces four of each.
 *
 * Keyed by URL rather than name because the URL is the stable identifier and
 * the display name has been reworded more than once.
 *
 * A source this catalogue cannot licence is emitted as a CreativeWork instead
 * of a Dataset. `isBasedOn` accepts either, Google does not validate
 * CreativeWork, and the alternative is inventing a licence for a publisher
 * that never stated one.
 */
type SourceEntry = {
  description: string;
  creator: { '@type': 'Organization'; name: string; url: string };
  /**
   * A licence URL, or a CreativeWork where the terms need a sentence. Omitted
   * when the publisher states no terms at all, which downgrades the node.
   */
  license?: string | { '@type': 'CreativeWork'; name: string; url: string };
};

/**
 * Works of the US government carry no copyright under 17 USC 105. This is the
 * label data.gov's own records use for exactly that, so it is the one a
 * consumer reading our markup already recognises.
 *
 * The CMS provider-data metastore returns `license: null` for its own
 * datasets. That is not evidence against this: federal works are public domain
 * by statute rather than by declaration.
 */
const US_PUBLIC_DOMAIN = 'https://www.usa.gov/publicdomain/label/1.0/';

const CMS = {
  '@type': 'Organization' as const,
  name: 'Centers for Medicare & Medicaid Services',
  url: 'https://www.cms.gov/',
};

const SOURCE_CATALOG: Record<string, SourceEntry> = {
  'https://directory.cms.gov/': {
    description:
      'The CMS National Provider Directory bulk FHIR R4 export, covering Practitioner, PractitionerRole, Organization, Location, Endpoint and related resources.',
    creator: CMS,
    license: US_PUBLIC_DOMAIN,
  },
  'https://download.cms.gov/nppes/NPI_Files.html': {
    description:
      'The federal National Plan and Provider Enumeration System registry of every issued National Provider Identifier and its self-attested taxonomy and address.',
    creator: CMS,
    license: US_PUBLIC_DOMAIN,
  },
  'https://data.cms.gov/provider-data/dataset/mj5m-pzi6': {
    description:
      'CMS Provider Data Catalog file listing Medicare-enrolled clinicians with their group practice affiliations, specialties and practice addresses.',
    creator: CMS,
    license: US_PUBLIC_DOMAIN,
  },
  'https://data.cms.gov/provider-data/dataset/xubh-q36u': {
    description:
      'CMS Provider Data Catalog file listing every Medicare-certified hospital in the United States with its address, ownership and county.',
    creator: CMS,
    license: US_PUBLIC_DOMAIN,
  },
  // Two AINPI sources share this URL: the Revalidation Reassignment List and
  // the Public Provider Enrollment File. The description covers both.
  'https://data.cms.gov/provider-characteristics/medicare-provider-supplier-enrollment': {
    description:
      'CMS Medicare provider and supplier enrollment files, covering the reassignment of billing rights from individual providers to group practices and the enrolled provider type of each NPI.',
    creator: CMS,
    license: US_PUBLIC_DOMAIN,
  },
  'https://github.com/Enterprise-CMCS/SMA-Endpoint-Directory': {
    description:
      'CMS-maintained index of state Medicaid agency provider-directory API endpoints, one row per jurisdiction.',
    creator: CMS,
    // The repository carries no LICENSE file, which GitHub reports as no
    // licence. It is a CMS work product either way.
    license: US_PUBLIC_DOMAIN,
  },
  'https://providerdirectory-api.capbluecross.com/r4': {
    description:
      'A payer provider-directory FHIR R4 API published under the CMS Interoperability and Patient Access rule (CMS-9115-F).',
    creator: {
      '@type': 'Organization',
      name: 'Capital BlueCross',
      url: 'https://www.capbluecross.com/',
    },
    // No licence, deliberately. The rule obliges the payer to serve this
    // without authentication and says nothing about reuse terms, so there is
    // nothing here to cite. This node is emitted as a CreativeWork.
  },
  'https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40': {
    description:
      'The National Uniform Claim Committee code set classifying provider type, specialty and subspecialty for every National Provider Identifier.',
    creator: {
      '@type': 'Organization',
      name: 'National Uniform Claim Committee',
      url: 'https://www.nucc.org/',
    },
    // Not a public-domain federal work, and the terms are narrower than any
    // licence URL would say. Same wording as /data-sources, which is where a
    // reader is sent to check it.
    license: {
      '@type': 'CreativeWork',
      name: 'Public; permission required for redistribution',
      url: 'https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40',
    },
  },
  'https://www.census.gov/programs-surveys/popest.html': {
    description:
      'US Census Bureau county population estimates and the ZCTA-to-county relationship file, used to attach geography to provider records.',
    creator: {
      '@type': 'Organization',
      name: 'US Census Bureau',
      url: 'https://www.census.gov/',
    },
    license: US_PUBLIC_DOMAIN,
  },
  'https://www.ers.usda.gov/data-products/rural-urban-continuum-codes/': {
    description:
      'USDA Economic Research Service codes classifying each US county on a continuum from metropolitan to completely rural.',
    creator: {
      '@type': 'Organization',
      name: 'USDA Economic Research Service',
      url: 'https://www.ers.usda.gov/',
    },
    license: US_PUBLIC_DOMAIN,
  },
};

/**
 * One `isBasedOn` entry, typed Dataset when the catalogue can fill every field
 * Google validates and CreativeWork when it cannot.
 */
function sourceNode(s: { name: string; url: string; description?: string }) {
  const entry = SOURCE_CATALOG[s.url];
  const description =
    s.description ??
    entry?.description ??
    `Upstream public dataset used as a source for this AINPI finding: ${s.name}.`;

  if (!entry?.license) {
    return {
      '@type': 'CreativeWork',
      name: s.name,
      url: s.url,
      description,
      ...(entry ? { creator: entry.creator } : {}),
    };
  }

  return {
    '@type': 'Dataset',
    name: s.name,
    url: s.url,
    description,
    creator: entry.creator,
    license: entry.license,
  };
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
        isBasedOn: sources.map(sourceNode),
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
