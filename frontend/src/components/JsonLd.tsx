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
  /** Upstream source, for datasets not derived from the NDH bulk files. */
  basedOn?: { name: string; url: string };
}) {
  const abs = (u: string) => (u.startsWith('http') ? u : `${SITE}${u}`);

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
        isBasedOn: [{ '@type': 'Dataset', ...basedOn }],
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
