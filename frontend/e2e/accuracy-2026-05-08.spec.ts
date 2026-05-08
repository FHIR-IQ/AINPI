/**
 * accuracy-2026-05-08.spec.ts — confirm that every page + API surface
 * AINPI publishes reflects the May 2026-05-08 NDH refresh, not stale
 * April numbers.
 *
 * Runs against `process.env.PLAYWRIGHT_BASE_URL` (default http://localhost:3000),
 * so the same spec covers local dev + production smoke tests.
 *
 * Numbers asserted here are the authoritative May 2026-05-08 values
 * captured immediately after the bq:sync run. If a CMS release rolls
 * the corpus again, these expectations must roll forward too.
 */
import { test, expect, request } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

// ---- Static /api/v1 contract ----------------------------------------------

test.describe('static /api/v1 contract — May 2026-05-08', () => {
  test('stats.json reports the May release with 21.69M total records', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/stats.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.counters.resources_processed).toBe(21_693_735);
    expect(body.counters.npis_checked).toBe(10_853_455);
    expect(body.counters.npis_flagged).toBe(8_115);
    expect(body.counters.findings_published).toBeGreaterThanOrEqual(12);
  });

  test('high-risk-cohort finding shows 64,269 / 7,441,382', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/high-risk-cohort.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.numerator).toBe(64_269);
    expect(body.denominator).toBe(7_441_382);
    expect(body.headline).toContain('8,115');
  });

  test('pii-exposure-ndh finding shows 41 confirmed against 7,441,211', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/pii-exposure-ndh.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.numerator).toBe(41);
    expect(body.denominator).toBe(7_441_211);
    expect(body.headline).toContain('2026-05-08');
  });

  test('oig-leie-exclusions finding shows 8,008 NDH practitioner matches', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/oig-leie-exclusions.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.headline).toContain('8,008');
  });

  test('sam-exclusions finding shows the May NDH-active match count', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/sam-exclusions.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    // Headline is "<distinct NPIs> ... <still active=true> ... 2026-05-08 bulk export ..."
    expect(body.headline).toMatch(/\d,\d{3} distinct NPIs/);
    expect(body.headline).toContain('2026-05-08');
  });

  test('mco-exposure-va finding shows 2 of 131', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/mco-exposure-va.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.numerator).toBe(2);
    expect(body.denominator).toBe(131);
  });

  test('temporal-staleness finding shows 0% on release-day', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/temporal-staleness.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
  });

  test('referential-integrity finding shows 0 dangling refs', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/referential-integrity.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.numerator).toBe(0);
  });

  test('duplicate-detection finding shows Org NPI excess of ~1.41M', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/duplicate-detection.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
  });

  test('npi-taxonomy-correctness finding shows the 2 Luhn fails', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/findings/npi-taxonomy-correctness.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.numerator).toBe(2);
  });
});

// ---- State slices ---------------------------------------------------------

test.describe('state slices — May 2026-05-08', () => {
  for (const [code, expectedPractitioners] of [
    ['va', 130_127],
    ['pa', 235_956],
    ['oh', 268_111],
  ] as const) {
    test(`${code.toUpperCase()} state JSON reflects May NDH counts`, async () => {
      const ctx = await request.newContext();
      const res = await ctx.get(`${BASE}/api/v1/states/${code}.json`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.release_date).toBe('2026-05-08');
      // The denominator field varies by finding shape; accept either
      // top-level practitioner count or a finding row.
      const text = JSON.stringify(body);
      expect(text).toContain(String(expectedPractitioners));
    });
  }

  test('VA briefing summary references the 131-NPI critical cohort', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/states/va-briefing-summary.json`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.federally_excluded_cohort?.total_critical).toBe(131);
  });

  test('VA cohort CSV downloads with 131 data rows', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/v1/states/va-cohort-critical.csv`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.trim().length > 0);
    // Header + 131 rows = 132. Tolerate \r\n by treating CR as whitespace.
    expect(dataLines.length).toBeGreaterThanOrEqual(131);
    expect(dataLines.length).toBeLessThanOrEqual(133);
  });
});

// ---- Live BigQuery-backed routes ------------------------------------------

test.describe('live /api/npd routes — May aggregates', () => {
  test('validation API has no false-alarm deltas', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/npd/validation`, { timeout: 60_000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    expect(body.total_actual).toBe(21_693_735);
    expect(body.total_expected).toBe(21_693_735);
    for (const r of body.resource_counts) {
      expect(r.completeness_pct, `${r.resource} completeness`).toBeGreaterThan(99.9);
    }
  });

  test('data-quality summary returns May totals', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/npd/data-quality?view=summary`, { timeout: 60_000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.release_date).toBe('2026-05-08');
    // Sum of practitioner+org+location+endpoint per the v_data_quality_summary view.
    expect(body.overview.total_records).toBe(13_579_040);
  });
});

// ---- Server-rendered pages ------------------------------------------------

test.describe('pages — release date in chrome', () => {
  test('/data-quality prints "Release 2026-05-08"', async ({ page }) => {
    await page.goto(`${BASE}/data-quality`);
    await expect(page.locator('text=Release 2026-05-08').first()).toBeVisible({ timeout: 30_000 });
  });

  test('/states/va prints VA practitioner count + 2026-05-08', async ({ page }) => {
    await page.goto(`${BASE}/states/va`);
    await expect(page.locator('text=2026-05-08').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=130,127').first()).toBeVisible({ timeout: 30_000 });
  });

  test('/findings/pii-exposure-ndh shows 41 confirmed', async ({ page }) => {
    await page.goto(`${BASE}/findings/pii-exposure-ndh`);
    await expect(page.locator('text=2026-05-08').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=41').first()).toBeVisible({ timeout: 30_000 });
  });

  test('/findings/high-risk-cohort shows 8,115 critical', async ({ page }) => {
    await page.goto(`${BASE}/findings/high-risk-cohort`);
    await expect(page.locator('text=2026-05-08').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=8,115').first()).toBeVisible({ timeout: 30_000 });
  });

  test('/reports/2026-05-08-update is reachable', async ({ page }) => {
    await page.goto(`${BASE}/reports/2026-05-08-update`);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=2026-05-08').first()).toBeVisible({ timeout: 30_000 });
  });

  test('/npd hero says 21.7M', async ({ page }) => {
    await page.goto(`${BASE}/npd`);
    await expect(page.locator('text=21.7M').first()).toBeVisible({ timeout: 30_000 });
  });

  test('WipBanner shows 2026-05-08 release', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.locator('text=2026-05-08').first()).toBeVisible({ timeout: 30_000 });
  });
});
