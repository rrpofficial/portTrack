/**
 * US-8.5 — Application shell UI  ·  US-9.7 — E2E against the containerized stack
 *
 * Playwright. Base URL points at the compose stack (http://localhost:${PORTTRACK_WEB_PORT}),
 * so this suite exercises the real containers, not a dev server.
 */
import { test, expect } from '@playwright/test';

const PASSPHRASE = process.env.PORTTRACK_TEST_PASSPHRASE ?? 'correct horse battery staple';

test.describe('US-8.5 Scenario: Core navigation exists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Vault passphrase').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).click();
  });

  for (const section of [
    'Dashboard',
    'Ledger',
    'Import',
    'Snapshots',
    'Tax',
    'Compliance',
    'Settings',
  ]) {
    test(`exposes the ${section} section`, async ({ page }) => {
      await expect(page.getByRole('link', { name: section })).toBeVisible();
    });
  }
});

test.describe('US-8.5 Scenario: The dashboard shows net worth with an asset-class breakdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Vault passphrase').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).click();
  });

  test('shows net worth in INR', async ({ page }) => {
    await expect(page.getByTestId('net-worth')).toContainText('₹');
  });

  test('shows the asset-class allocation', async ({ page }) => {
    await expect(page.getByTestId('allocation-breakdown')).toBeVisible();
  });

  test('offers a snapshot-comparison entry point', async ({ page }) => {
    await expect(page.getByRole('button', { name: /compare/i })).toBeVisible();
  });
});

test.describe('US-9.7 Scenario: End-to-end journey against the containerized stack', () => {
  test('unlock → import → snapshot → compare → advance tax', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Vault passphrase').fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).click();

    await page.getByRole('link', { name: 'Import' }).click();
    await page.getByLabel('Statement file').setInputFiles('tests/fixtures/zerodha/tradebook.csv');
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByTestId('import-summary')).toContainText('40');

    await page.getByRole('link', { name: 'Snapshots' }).click();
    await page.getByRole('button', { name: 'Create snapshot' }).click();
    await expect(page.getByTestId('snapshot-list')).toContainText('CUSTOM');

    await page.getByRole('button', { name: /compare/i }).click();
    await expect(page.getByTestId('variance-table')).toBeVisible();

    await page.getByRole('link', { name: 'Tax' }).click();
    await page.getByRole('button', { name: 'Compute advance tax' }).click();
    await expect(page.getByTestId('advance-tax-payable')).toContainText('₹');
  });
});
