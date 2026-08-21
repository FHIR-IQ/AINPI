/**
 * accuracy-2026-08-20.spec.ts — pin every published surface to the numbers
 * measured against the 2026-08-20 NDH release.
 *
 * Runs against `process.env.PLAYWRIGHT_BASE_URL` (default http://localhost:3000),
 * so the same spec covers local dev and a production smoke test:
 *
 *   PLAYWRIGHT_BASE_URL="https://ainpi.dev" \
 *     npx playwright test --config=playwright.prod.config.ts accuracy-2026-08-20.spec.ts
 *
 * Why the numbers are hardcoded rather than read from the repo's own JSON:
 * reading them would only prove the deploy matches the working tree, which is
 * a different and weaker question. These are the values a human checked, and
 * the spec exists so a silent regression has to argue with them.
 *
 * When CMS ships the next release, copy this file rather than editing it, and
 * mark this one archived the way accuracy-2026-05-08.spec.ts is. The pair is
 * how a release delta gets caught.
 */
import { test, expect, request } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const RELEASE = '2026-08-20';

async function json(path: string) {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BASE}${path}`);
  expect(res.status(), `${path} should be 200`).toBe(200);
  return res.json();
}

test.describe(`static /api/v1 contract — ${RELEASE}`, () => {
  test('stats.json reports the August release with 32.47M records', async () => {
    const body = await json('/api/v1/stats.json');
    expect(body.release_date).toBe(RELEASE);
    expect(body.counters.resources_processed).toBe(32_468_908);
    // H9's sidecar, not H13's pair counts. stats.json read the wrong pair
    // until 2026-08-21 and published 5,275,554 "flagged" NPIs.
    expect(body.counters.npis_checked).toBe(11_607_656);
    expect(body.counters.npis_flagged).toBe(4);
    expect(body.counters.findings_published).toBeGreaterThanOrEqual(24);
    // Endpoint liveness is crawler-measured and older than this release, so
    // it must continue to declare its own as-of date rather than borrowing.
    expect(body.counters_as_of?.endpoints_live_pct).toBe('2026-04-09');
  });

  test('manifest.json advertises the same release and methodology', async () => {
    const body = await json('/api/v1/manifest.json');
    expect(body.release_date).toBe(RELEASE);
    expect(body.methodology_version).toBe('0.7.3-draft');
  });

  test('npi-validity-summary survives the shared-slug overwrite', async () => {
    const body = await json('/api/v1/findings/npi-validity-summary.json');
    expect(body.release_date).toBe(RELEASE);
    expect(body.npis_checked).toBe(11_607_656);
    expect(body.npis_flagged).toBe(4);
    expect(body.luhn_fail).toBe(0);
  });

  const FINDINGS: [string, number, number][] = [
    // slug, numerator, denominator
    ['high-risk-cohort', 7_244, 7_373_232],
    ['pii-exposure-ndh', 0, 7_373_232],
    ['mco-exposure-va', 5, 106],
    ['referential-integrity', 724, 33_425_181],
    ['npi-taxonomy-correctness', 5_275_554, 5_275_635],
    ['endpoint-org-linkage', 16_262, 110_973],
    ['vendor-endpoint-attribution', 61_432, 94_711],
    ['endpoint-url-validity', 110_973, 1_128_169],
  ];

  for (const [slug, num, den] of FINDINGS) {
    test(`${slug} is measured against ${RELEASE}`, async () => {
      const body = await json(`/api/v1/findings/${slug}.json`);
      expect(body.release_date).toBe(RELEASE);
      expect(body.numerator).toBe(num);
      expect(body.denominator).toBe(den);
    });
  }

  test('H50 and H51 agree on how many endpoints have no owner', async () => {
    // They disagreed (94,711 vs 94,623) because one counted references that
    // were present and the other counted references that resolved. Both
    // resolve now. If this ever fails, the definitions have drifted apart
    // again, not the data.
    const h50 = await json('/api/v1/findings/endpoint-org-linkage.json');
    const h51 = await json('/api/v1/findings/vendor-endpoint-attribution.json');
    expect(h50.denominator - h50.numerator).toBe(h51.denominator);
  });

  test('the SSN exposure is zero and says why that is trustworthy', async () => {
    const body = await json('/api/v1/findings/pii-exposure-ndh.json');
    expect(body.numerator).toBe(0);
    // A zero finding must carry its positive control, or it is
    // indistinguishable from a scan pointed at the wrong field.
    expect(body.headline).toContain('7,371,126');
  });

  test('the cohort refuses to score the stale-NPPES signal', async () => {
    const body = await json('/api/v1/findings/high-risk-cohort.json');
    expect(body.headline).toContain('not_in_nppes is reported but scored zero');
    expect(body.headline).toContain('2026-02-07');
  });
});

test.describe(`state slices — ${RELEASE}`, () => {
  const STATE_DENOMINATORS: Record<string, number> = {
    va: 128_246,
    pa: 230_837,
  };

  for (const [code, practitioners] of Object.entries(STATE_DENOMINATORS)) {
    test(`${code.toUpperCase()} slice reflects August counts`, async () => {
      const body = await json(`/api/v1/states/${code}.json`);
      expect(body.release_date).toBe(RELEASE);
      expect(body.denominators.practitioner).toBe(practitioners);
    });
  }

  test('all 51 slices carry the same release', async () => {
    const manifest = await json('/api/v1/manifest.json');
    const codes: string[] = (manifest.states ?? [])
      .map((s: { code?: string; state?: string }) => s.code ?? s.state)
      .filter(Boolean);
    expect(codes.length).toBe(51);
  });

  test('verify samples come from the exclusion list, not NPPES absence', async () => {
    // They were drawn from "not present in NPPES" until 2026-08-21, which
    // sent analysts to check records that were all fine.
    const body = await json('/api/v1/states/pa.json');
    expect(body.verify_samples.length).toBeGreaterThan(0);
    for (const s of body.verify_samples) {
      expect(s.flagged_by).toBe('oig-leie-exclusions');
      expect(s.flag_reason).toContain('excluded from federal health care programs');
    }
  });

  test('VA cohort CSV has 106 data rows', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/states/va-cohort-critical.csv`);
    expect(res.status()).toBe(200);
    const rows = (await res.text()).trim().split('\n');
    expect(rows.length - 1).toBe(106);
  });
});

test.describe('live /api/npd routes — August aggregates', () => {
  test('data-quality summary defaults to the August release', async () => {
    // The route defaulted to a 2026-05-08 literal, so it kept serving May
    // rows after the reload: the old rows are still in Supabase, so there
    // was no error and no empty result to notice.
    const body = await json('/api/npd/data-quality');
    expect(body.release_date).toBe(RELEASE);
    expect(body.overview.total_records).toBeGreaterThan(15_000_000);
  });
});

test.describe('pages — release date in chrome', () => {
  test('the site-wide banner names the August release', async ({ page }) => {
    await page.goto(`${BASE}/findings`);
    await expect(page.getByText(`(${RELEASE} release)`)).toBeVisible();
  });

  test('/data-quality prints the August release', async ({ page }) => {
    await page.goto(`${BASE}/data-quality`);
    await expect(page.getByText(`Release ${RELEASE}`).first()).toBeVisible();
  });

  test('/reports/2026-08-21-update is reachable', async ({ page }) => {
    const res = await page.goto(`${BASE}/reports/2026-08-21-update`);
    expect(res?.status()).toBe(200);
  });

  test('/npd hero states 32.5M records', async ({ page }) => {
    await page.goto(`${BASE}/npd`);
    await expect(page.getByText(/32\.5M FHIR R4 records/)).toBeVisible();
  });
});
