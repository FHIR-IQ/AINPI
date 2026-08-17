/**
 * Guards the schema.org `isBasedOn` provenance on finding pages.
 *
 * `DatasetJsonLd` defaults `basedOn` to the CMS NDH bulk files, which is right
 * for most findings and wrong for the ones built from somewhere else. The
 * failure is silent: the page renders, the markup validates, and it credits CMS
 * for data CMS did not publish. Before this test the rural pages overrode the
 * source at the page level while their own /findings/<slug> pages did not.
 */
import { describe, expect, it } from 'vitest';

import { FINDINGS } from '@/data/findings';

/**
 * Findings that must declare their own sources: either their numbers do not
 * come from the NDH bulk export at all, or the NDH is one source among
 * several and the default would credit CMS for the rest. Adding a finding here
 * without setting `basedOn` on it fails the suite.
 */
const NON_NDH_SLUGS = [
  'rural-hospital-baseline',
  'pa-rural-hospital-connectivity',
  'state-medicaid-directory-coverage',
  'payer-affiliation-gap',
  'role-gap-composition',
];

describe('finding provenance (schema.org isBasedOn)', () => {
  it.each(NON_NDH_SLUGS)('%s declares its own upstream sources', (slug) => {
    const finding = FINDINGS.find((f) => f.slug === slug);
    expect(finding, `no finding registered for ${slug}`).toBeDefined();
    expect(finding!.basedOn?.length ?? 0).toBeGreaterThan(0);
  });

  it('every declared source has a name and an absolute URL', () => {
    for (const finding of FINDINGS) {
      for (const source of finding.basedOn ?? []) {
        expect(source.name.length, `${finding.slug} source name`).toBeGreaterThan(0);
        expect(source.url, `${finding.slug} source url`).toMatch(/^https?:\/\//);
      }
    }
  });

  it('NDH-derived findings leave basedOn unset so they inherit the default', () => {
    const ndhBacked = FINDINGS.filter((f) => !NON_NDH_SLUGS.includes(f.slug));
    for (const finding of ndhBacked) {
      expect(finding.basedOn, `${finding.slug} should inherit the NDH default`)
        .toBeUndefined();
    }
  });
});
