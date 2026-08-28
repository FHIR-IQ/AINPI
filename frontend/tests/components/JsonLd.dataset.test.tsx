import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DatasetJsonLd } from '@/components/JsonLd';
import { FINDINGS } from '@/data/findings';

/**
 * Search Console has reported the same shape of error twice against this
 * site's Dataset markup: first "Missing field description", then "Missing
 * field creator" and "Missing field license". Each time the top-level Dataset
 * carried the field all along and the nested `isBasedOn` nodes did not, because
 * Google validates every node typed Dataset rather than only the root. A
 * findings page declaring four sources produced four of each error.
 *
 * These tests walk the emitted object rather than checking the one field that
 * was wrong last, so any future nesting that introduces an underpopulated
 * Dataset node fails here instead of in Search Console six weeks later.
 */

function parse(container: HTMLElement): Record<string, unknown> {
  const el = container.querySelector('script[type="application/ld+json"]');
  expect(el, 'no ld+json script rendered').not.toBeNull();
  return JSON.parse(el!.textContent || '{}');
}

/** Every node in the tree whose @type is Dataset, root included. */
function datasetNodes(value: unknown, found: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    value.forEach((v) => datasetNodes(v, found));
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (node['@type'] === 'Dataset') found.push(node);
    Object.values(node).forEach((v) => datasetNodes(v, found));
  }
  return found;
}

const BASE = {
  name: 'Test finding',
  description:
    'A description comfortably longer than the fifty characters Google requires before it drops the dataset entirely.',
  url: '/findings/test',
  distributionUrls: [
    { url: '/api/v1/findings/test.json', format: 'application/json' as const },
  ],
};

/** Every node in the tree whose @type is CreativeWork. */
function creativeWorkNodes(value: unknown, found: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    value.forEach((v) => creativeWorkNodes(v, found));
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (node['@type'] === 'CreativeWork') found.push(node);
    Object.values(node).forEach((v) => creativeWorkNodes(v, found));
  }
  return found;
}

describe('DatasetJsonLd nested Dataset nodes', () => {
  it('gives every Dataset node a description, not just the root', () => {
    const { container } = render(
      <DatasetJsonLd
        {...BASE}
        basedOn={[
          { name: 'CMS National Provider Directory public use files', url: 'https://directory.cms.gov/' },
          { name: 'USDA ERS Rural-Urban Continuum Codes', url: 'https://www.ers.usda.gov/data-products/rural-urban-continuum-codes/' },
        ]}
      />,
    );
    const nodes = datasetNodes(parse(container));
    expect(nodes.length).toBe(3); // root + two sources

    for (const node of nodes) {
      expect(
        typeof node.description === 'string' && (node.description as string).length > 0,
        `Dataset node "${String(node.name)}" has no description`,
      ).toBe(true);
    }
  });

  it('lets a caller override the catalogued description', () => {
    const { container } = render(
      <DatasetJsonLd
        {...BASE}
        basedOn={[
          {
            name: 'CMS National Provider Directory public use files',
            url: 'https://directory.cms.gov/',
            description: 'An explicitly supplied description.',
          },
        ]}
      />,
    );
    const source = datasetNodes(parse(container)).find(
      (n) => n.url === 'https://directory.cms.gov/',
    );
    expect(source!.description).toBe('An explicitly supplied description.');
  });

  it('defaults isBasedOn to the NDH files, which carry a description', () => {
    const { container } = render(<DatasetJsonLd {...BASE} />);
    const nodes = datasetNodes(parse(container));
    expect(nodes.length).toBe(2);
    expect(String(nodes[1].description).length).toBeGreaterThan(0);
  });
});

describe('every Dataset node carries what Google validates', () => {
  // Search Console flagged creator and license after description was fixed.
  // Walking the whole tree means the next recommended field cannot regress
  // silently on the nested nodes while the root looks fine.
  it.each(['description', 'creator', 'license'])('every Dataset node has %s', (field) => {
    const { container } = render(
      <DatasetJsonLd
        {...BASE}
        basedOn={[
          { name: 'CMS National Provider Directory public use files', url: 'https://directory.cms.gov/' },
          { name: 'NUCC Healthcare Provider Taxonomy', url: 'https://www.nucc.org/index.php/code-sets-mainmenu-41/provider-taxonomy-mainmenu-40' },
        ]}
      />,
    );
    for (const node of datasetNodes(parse(container))) {
      expect(node[field], `Dataset node "${String(node.name)}" has no ${field}`).toBeTruthy();
    }
  });

  it('types an uncatalogued source CreativeWork rather than an unlicensed Dataset', () => {
    const { container } = render(
      <DatasetJsonLd
        {...BASE}
        basedOn={[{ name: 'Some Future Registry', url: 'https://example.gov/not-yet-catalogued' }]}
      />,
    );
    const doc = parse(container);
    // Only the root is a Dataset: we cannot state this source's licence, and
    // inventing one is worse than the warning it would silence.
    expect(datasetNodes(doc).length).toBe(1);
    const source = creativeWorkNodes(doc).find((n) => n.name === 'Some Future Registry');
    expect(source, 'uncatalogued source was dropped, not downgraded').toBeDefined();
    expect(String(source!.description)).toContain('Some Future Registry');
  });

  it('keeps the payer directory a CreativeWork, because no licence exists to cite', () => {
    const { container } = render(
      <DatasetJsonLd
        {...BASE}
        basedOn={[
          { name: 'Capital BlueCross provider directory API', url: 'https://providerdirectory-api.capbluecross.com/r4' },
        ]}
      />,
    );
    const doc = parse(container);
    expect(datasetNodes(doc).length).toBe(1);
    const source = creativeWorkNodes(doc).find(
      (n) => n.url === 'https://providerdirectory-api.capbluecross.com/r4',
    );
    expect(source).toBeDefined();
    // Catalogued, so it still names its publisher and describes itself.
    expect(source!.creator).toBeTruthy();
    expect(String(source!.description)).toContain('CMS-9115-F');
  });
});

describe('every declared finding source is catalogued', () => {
  /**
   * A URL that is not a catalogue key still renders, with a generic sentence
   * and no creator. That is the honest fallback and it is also what a typo
   * looks like, so pin it here: a source declared in findings.ts is expected
   * to be one we have checked.
   */
  const sources = FINDINGS.flatMap((f) => f.basedOn ?? []);

  it('has at least one declared source to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources.map((s) => [s.url, s] as const))('%s is catalogued', (_url, source) => {
    const { container } = render(<DatasetJsonLd {...BASE} basedOn={[source]} />);
    const doc = parse(container);
    const node = [...datasetNodes(doc), ...creativeWorkNodes(doc)].find(
      (n) => n.url === source.url,
    );
    expect(node, `no isBasedOn node rendered for ${source.url}`).toBeDefined();
    expect(node!.creator, `${source.url} is not in SOURCE_CATALOG`).toBeTruthy();
  });
});

describe('published findings clear the Google description floor', () => {
  // Under 50 characters and Google drops the dataset rather than warning.
  it.each(FINDINGS.filter((f) => f.status === 'published').map((f) => [f.slug, f.summary] as const))(
    '%s has a summary of at least 50 characters',
    (_slug, summary) => {
      expect(summary.length).toBeGreaterThanOrEqual(50);
    },
  );
});
