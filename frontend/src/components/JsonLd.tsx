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

export function DatasetJsonLd({
  name,
  description,
  url,
  distributionUrls,
  dateModified,
  keywords,
  measurementTechnique,
  citation,
}: {
  name: string;
  description: string;
  url: string;
  /** Direct links to the machine-readable payloads. */
  distributionUrls: { url: string; format: 'application/json' | 'text/csv' }[];
  dateModified?: string;
  keywords?: string[];
  measurementTechnique?: string;
  citation?: string;
}) {
  return (
    <LdScript
      data={{
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name,
        description,
        url: url.startsWith('http') ? url : `${SITE}${url}`,
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        isAccessibleForFree: true,
        creator: { '@type': 'Organization', name: 'AINPI', url: SITE },
        publisher: { '@type': 'Organization', name: 'AINPI', url: SITE },
        ...(dateModified ? { dateModified } : {}),
        ...(keywords?.length ? { keywords } : {}),
        ...(measurementTechnique ? { measurementTechnique } : {}),
        ...(citation ? { citation } : {}),
        distribution: distributionUrls.map((d) => ({
          '@type': 'DataDownload',
          encodingFormat: d.format,
          contentUrl: d.url.startsWith('http') ? d.url : `${SITE}${d.url}`,
        })),
        isBasedOn: [
          {
            '@type': 'Dataset',
            name: 'CMS National Provider Directory public use files',
            url: 'https://directory.cms.gov/',
          },
        ],
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
