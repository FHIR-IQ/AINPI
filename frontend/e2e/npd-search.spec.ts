import { test, expect } from '@playwright/test';

test.describe('NPD Search Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/npd');
  });

  test('loads the search page with title and form', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('National Provider Directory Search');
    await expect(page.locator('button:has-text("Search by NPI")')).toBeVisible();
    await expect(page.locator('button:has-text("Search by Name")')).toBeVisible();
    await expect(page.locator('button:has-text("Search by Organization")')).toBeVisible();
    await expect(page.locator('button:has-text("Search Directory")')).toBeVisible();
  });

  test('NPI search field accepts 10 digits', async ({ page }) => {
    const npiInput = page.locator('input[placeholder*="1234567890"]');
    await npiInput.fill('1234567890');
    await expect(npiInput).toHaveValue('1234567890');
  });

  test('switches between search types', async ({ page }) => {
    // Default is NPI
    await expect(page.locator('input[placeholder*="1234567890"]')).toBeVisible();

    // Switch to Name
    await page.click('button:has-text("Search by Name")');
    await expect(page.locator('input[placeholder*="Last name"]')).toBeVisible();

    // Switch to Organization
    await page.click('button:has-text("Search by Organization")');
    await expect(page.locator('input[placeholder*="Mayo Clinic"]')).toBeVisible();
  });

  test('state field uppercases input', async ({ page }) => {
    const stateInput = page.locator('input[placeholder*="CA"]');
    await stateInput.fill('ca');
    await expect(stateInput).toHaveValue('CA');
  });

  test('shows error on empty search', async ({ page }) => {
    await page.click('button:has-text("Search Directory")');
    // Should show an error since no params provided
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Data Quality Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/data-quality');
  });

  test('loads the dashboard with tabs', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('CMS National Provider Directory');
    await expect(page.locator('button:has-text("Overview")')).toBeVisible();
    await expect(page.locator('button:has-text("By State")')).toBeVisible();
    await expect(page.locator('button:has-text("By Specialty")')).toBeVisible();
    await expect(page.locator('button:has-text("Endpoints")')).toBeVisible();
  });

  test('tabs switch correctly', async ({ page }) => {
    await page.click('button:has-text("By State")');
    await expect(page.locator('input[placeholder*="Filter states"]')).toBeVisible();

    await page.click('button:has-text("By Specialty")');
    await expect(page.locator('input[placeholder*="Filter specialties"]')).toBeVisible();
  });

  test('state filter works', async ({ page }) => {
    await page.click('button:has-text("By State")');
    const filterInput = page.locator('input[placeholder*="Filter states"]');
    await filterInput.fill('CA');
    // Table should filter
    await expect(filterInput).toHaveValue('CA');
  });
});
