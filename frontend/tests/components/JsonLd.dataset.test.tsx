import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DatasetJsonLd } from '@/components/JsonLd';
import { FINDINGS } from '@/data/findings';

/**
 * Search Console reported "Missing field description" against this site's
 * Dataset markup, and the top-level Dataset had one all along. The nested
 * nodes did not: `isBasedOn` emitted `{'@type': 'Dataset', name, url}`, and
 * Google validates every node typed Dataset rather than only the root. A
 * findings page declaring four sources produced four errors.
 *
 * These tests walk the emitted object rather than checking the one field that
 * was wrong, so any future nesting that introduces a bare Dataset node fails
 * here instead of in Search Console six weeks later.
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

  it('falls back to a real sentence for a source it has no entry for', () => {
    const { container } = render(
      <DatasetJsonLd
        {...BASE}
        basedOn={[{ name: 'Some Future Registry', url: 'https://example.gov/not-yet-catalogued' }]}
      />,
    );
    const source = datasetNodes(parse(container)).find((n) => n.name === 'Some Future Registry');
    expect(source).toBeDefined();
    expect(String(source!.description)).toContain('Some Future Registry');
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

describe('published findings clear the Google description floor', () => {
  // Under 50 characters and Google drops the dataset rather than warning.
  it.each(FINDINGS.filter((f) => f.status === 'published').map((f) => [f.slug, f.summary] as const))(
    '%s has a summary of at least 50 characters',
    (_slug, summary) => {
      expect(summary.length).toBeGreaterThanOrEqual(50);
    },
  );
});
