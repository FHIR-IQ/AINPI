import { describe, it, expect } from 'vitest';
import type { NetworksPayload } from '@/lib/api-v1-types';
import { publishedFindingSlugs } from '@/lib/networks-published';

const payload = {
  use_cases: [
    {
      slug: 'find-endpoint',
      label: 'x',
      summary: '',
      ainpi_links: [
        { label: 'a', finding_slug: 'endpoint-url-validity' },
        { label: 'b', finding_slug: 'not-a-real-finding-slug' },
        { label: 'c', href: '/states/pa/connectivity' },
      ],
    },
  ],
  routes: [{ ainpi_links: [{ label: 'd', finding_slug: 'payer-seed-coverage' }] }],
} as unknown as NetworksPayload;

describe('publishedFindingSlugs', () => {
  it('returns only the referenced slugs whose finding is published', () => {
    expect(publishedFindingSlugs(payload)).toEqual(['endpoint-url-validity']);
  });
});
