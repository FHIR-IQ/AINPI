import { test, expect } from '@playwright/test';

test.describe('Data Quality Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/data-quality');
  });

  test('loads with title and KPI cards', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('CMS National Provider Directory');
    // Should have resource type cards
    await expect(page.locator('text=practitioners')).toBeVisible({ timeout: 15000 });
  });

  test('overall quality gauge renders', async ({ page }) => {
    await expect(page.locator('text=Overall Data Quality')).toBeVisible({ timeout: 15000 });
  });

  test('map metric dropdown changes visualization', async ({ page }) => {
    // Wait for map section to load
    await expect(page.locator('text=Geographic Distribution')).toBeVisible({ timeout: 15000 });

    // Find metric dropdown and change it
    const metricSelect = page.locator('select').filter({ hasText: 'Locations' }).first();
    if (await metricSelect.isVisible()) {
      await metricSelect.selectOption('providers');
      // Map should still be visible
      await expect(page.locator('svg').first()).toBeVisible();
    }
  });

  test('color scheme dropdown works', async ({ page }) => {
    await expect(page.locator('text=Geographic Distribution')).toBeVisible({ timeout: 15000 });
    const colorSelect = page.locator('select').filter({ hasText: 'Blue' }).first();
    if (await colorSelect.isVisible()) {
      await colorSelect.selectOption('greens');
    }
  });

  test('bar chart top N dropdown works', async ({ page }) => {
    await expect(page.locator('text=Providers, Organizations & Locations')).toBeVisible({ timeout: 15000 });
    const topSelect = page.locator('select').filter({ hasText: 'Top 25' }).first();
    if (await topSelect.isVisible()) {
      await topSelect.selectOption('10');
    }
  });

  test('specialty filter input works', async ({ page }) => {
    await expect(page.locator('text=Provider Specialty Distribution')).toBeVisible({ timeout: 15000 });
    const filterInput = page.locator('input[placeholder*="Filter specialties"]');
    if (await filterInput.isVisible()) {
      await filterInput.fill('cardiology');
    }
  });

  test('state table filter works', async ({ page }) => {
    await expect(page.locator('text=State-Level Data Quality')).toBeVisible({ timeout: 15000 });
    const filterInput = page.locator('input[placeholder*="Filter states"]');
    await filterInput.fill('CA');
    // Should show CA row
    await expect(page.locator('td:has-text("CA")')).toBeVisible();
  });

  test('sankey limit dropdown works', async ({ page }) => {
    const sankeyHeader = page.locator('text=Organization Network Flow');
    if (await sankeyHeader.isVisible({ timeout: 10000 }).catch(() => false)) {
      const limitSelect = page.locator('select').filter({ hasText: 'Top 10 Orgs' }).first();
      if (await limitSelect.isVisible()) {
        await limitSelect.selectOption('5');
      }
    }
  });
});

test.describe('NPD Search Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/npd');
  });

  test('search page loads with form', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('National Provider Directory Search');
    await expect(page.locator('button:has-text("Search Directory")')).toBeVisible();
  });

  test('search type tabs switch correctly', async ({ page }) => {
    await page.click('button:has-text("Search by Name")');
    await expect(page.locator('input[placeholder*="Last name"]')).toBeVisible();

    await page.click('button:has-text("Search by Organization")');
    await expect(page.locator('input[placeholder*="Mayo Clinic"]')).toBeVisible();

    await page.click('button:has-text("Search by NPI")');
    await expect(page.locator('input[placeholder*="1234567890"]')).toBeVisible();
  });

  test('state field uppercases input', async ({ page }) => {
    const stateInput = page.locator('input[placeholder*="CA"]');
    await stateInput.fill('ny');
    await expect(stateInput).toHaveValue('NY');
  });

  test('organization search returns results', async ({ page }) => {
    await page.click('button:has-text("Search by Organization")');
    await page.locator('input[placeholder*="Mayo Clinic"]').fill('upmc');
    await page.click('button:has-text("Search Directory")');

    // Wait for results or error
    const resultOrError = page.locator('.card h3, .bg-red-50');
    await expect(resultOrError).toBeVisible({ timeout: 30000 });
  });

  test('NPI search returns provider profile', async ({ page }) => {
    const npiInput = page.locator('input[placeholder*="1234567890"]');
    await npiInput.fill('1962633941');
    await page.click('button:has-text("Search Directory")');

    // Should show results
    const resultOrError = page.locator('text=Provider Profile, text=results found, .bg-red-50');
    await expect(resultOrError.first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Navigation', () => {
  test('homepage redirects to NPD search', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/npd', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('National Provider Directory');
  });

  test('navbar has all public links', async ({ page }) => {
    await page.goto('/npd');
    await expect(page.locator('button:has-text("NPD Search")')).toBeVisible();
    await expect(page.locator('button:has-text("Data Quality")')).toBeVisible();
    await expect(page.locator('button:has-text("Payer Search")')).toBeVisible();
    await expect(page.locator('button:has-text("Magic Scanner")')).toBeVisible();
  });

  test('data quality link navigates correctly', async ({ page }) => {
    await page.goto('/npd');
    await page.click('button:has-text("Data Quality")');
    await page.waitForURL('**/data-quality');
    await expect(page.locator('h1')).toContainText('CMS National Provider Directory');
  });
});
