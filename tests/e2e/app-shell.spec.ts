/**
 * US-8.5 — Application shell UI  ·  US-9.7 — E2E against the containerized stack
 *
 * Playwright, against the compose stack (http://localhost:${PORTTRACK_WEB_PORT}),
 * so this exercises the real containers rather than a dev server.
 *
 * **Every navigation assertion checks what the section RENDERS, not that a link
 * exists.** The original version asserted only that seven links were visible,
 * which passed against a nav whose links did nothing at all — the acceptance
 * criterion was satisfied to the letter by seven dead anchors.
 *
 * The suite runs in file order against one shared vault, because the journey is
 * cumulative: nothing can be imported before the vault is unlocked, and no
 * snapshot can be compared before something exists to snapshot.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PASSPHRASE = process.env.PORTTRACK_TEST_PASSPHRASE ?? 'correct horse battery staple';

const SECTIONS = [
  'Dashboard',
  'Ledger',
  'Import',
  'Snapshots',
  'Tax',
  'Compliance',
  'Settings',
] as const;

async function unlock(page: Page): Promise<void> {
  await page.goto('/');

  const passphrase = page.getByLabel('Vault passphrase');
  const nav = page.getByRole('link', { name: 'Dashboard', exact: true });

  // Wait for React to render EITHER state before deciding what to do. A bare
  // `isVisible()` here does not retry, so it answered "false" while the bundle
  // was still mounting, the unlock step was skipped, and the failure surfaced
  // later as a missing nav — nowhere near its cause.
  await expect(passphrase.or(nav).first()).toBeVisible();

  if (await passphrase.isVisible()) {
    await passphrase.fill(PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
  await expect(nav).toBeVisible();
}

async function goToSection(page: Page, section: string): Promise<void> {
  await page.getByRole('link', { name: section, exact: true }).click();
}

test.describe('US-8.5 Scenario: Core navigation exists', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
  });

  for (const section of SECTIONS) {
    test(`the ${section} link navigates to the ${section} section`, async ({ page }) => {
      await goToSection(page, section);

      // The URL changed...
      await expect(page).toHaveURL(new RegExp(`#/${section.toLowerCase()}$`));
      // ...the link is marked current...
      await expect(page.getByRole('link', { name: section, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // ...and the section actually rendered something of its own. This is the
      // assertion the original suite lacked.
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    });
  }

  test('a deep link opens its section directly', async ({ page }) => {
    await unlock(page);
    await page.goto('/#/compliance');
    await expect(page.getByRole('heading', { name: /Schedule FA/i })).toBeVisible();
  });

  test('the back button returns to the previous section', async ({ page }) => {
    await goToSection(page, 'Ledger');
    await goToSection(page, 'Settings');
    await page.goBack();
    await expect(page).toHaveURL(/#\/ledger$/);
  });
});

test.describe('US-8.5 Scenario: The dashboard shows net worth with an asset-class breakdown', () => {
  test.beforeEach(async ({ page }) => {
    await unlock(page);
  });

  test('shows net worth in INR', async ({ page }) => {
    await expect(page.getByTestId('net-worth')).toContainText('₹');
  });

  test('shows the asset-class allocation', async ({ page }) => {
    await expect(page.getByTestId('allocation-breakdown')).toBeVisible();
  });

  test('offers a snapshot-comparison entry point', async ({ page }) => {
    await page.getByRole('button', { name: /compare/i }).click();
    await expect(page).toHaveURL(/#\/snapshots$/);
  });
});

test.describe('US-9.7 Scenario: End-to-end journey against the containerized stack', () => {
  test('unlock → import → ledger → snapshot → compare → advance tax', async ({ page }) => {
    await unlock(page);

    /* ------------------------------------------------------------- import */
    await goToSection(page, 'Import');
    await page.getByLabel('Statement type').selectOption('ZERODHA_TRADEBOOK');
    await page.getByLabel('Statement file').setInputFiles('tests/fixtures/zerodha/tradebook.csv');
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    const summary = page.getByTestId('import-summary');
    await expect(summary).toBeVisible();
    // 65 rows in the fixture: 40 buys and 25 sells, all of them fresh the first
    // time this vault sees them.
    await expect(summary).toContainText('65');

    /* ------------------------------------------------------------- ledger */
    await goToSection(page, 'Ledger');
    const ledger = page.getByTestId('ledger-table');
    await expect(ledger).toBeVisible();
    await expect(ledger.getByRole('row')).not.toHaveCount(1);
    // The disposals table only renders when sells were actually applied.
    await expect(page.getByTestId('exit-table')).toBeVisible();

    /* ---------------------------------------------------------- dashboard */
    await goToSection(page, 'Dashboard');
    // The import must have moved net worth off zero, or nothing was committed.
    await expect(page.getByTestId('net-worth')).not.toContainText(/^₹0$/);

    /* ----------------------------------------------------------- snapshot */
    await goToSection(page, 'Snapshots');
    await page.getByRole('button', { name: 'Create snapshot' }).click();
    const snapshots = page.getByTestId('snapshot-list');
    await expect(snapshots).toContainText('CUSTOM');

    /* ------------------------------------------------------------ compare */
    await page.getByRole('button', { name: /compare to live/i }).first().click();
    await expect(page.getByTestId('variance-table')).toBeVisible();

    /* ---------------------------------------------------------------- tax */
    await goToSection(page, 'Tax');
    await page.getByRole('button', { name: 'Compute advance tax' }).click();
    await expect(page.getByTestId('advance-tax-payable')).toContainText('₹');
  });
});

test.describe('US-5.x Scenario: A provisional tax figure never looks filable', () => {
  test('shows the provisional banner wherever a tax figure appears', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Tax');
    await expect(page.getByText(/Provisional tax rates/i).first()).toBeVisible();
  });

  test('says so explicitly when no income has been recorded', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Tax');
    await page.getByRole('button', { name: 'Compute advance tax' }).click();
    // ₹0 from a missing Form 16 is not the same answer as ₹0 from a real one.
    await expect(page.getByTestId('no-income-profile')).toBeVisible();
  });
});

test.describe('US-6.x Scenario: Compliance states why a schedule is unavailable', () => {
  test('explains a missing Schedule AL rather than showing an empty table', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Compliance');
    await page.getByRole('button', { name: 'Generate' }).nth(1).click();

    // No 31-March snapshot exists in this run, and saying so is the correct
    // answer. An empty table would read as "you hold nothing".
    await expect(page.getByRole('alert')).toContainText(/snapshot/i);
  });
});

test.describe('US-8.2 Scenario: The unlock screen shows it is working', () => {
  /**
   * The unlock response is delayed deliberately rather than raced against the
   * real one: the busy window is a few hundred milliseconds, and a test that
   * tries to catch it as it happens is a flake generator.
   */
  async function withSlowUnlock(page: Page, ms: number): Promise<void> {
    await page.route('**/api/vault/unlock', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    });
  }

  test('disables the button and explains the wait while deriving the key', async ({ page }) => {
    await withSlowUnlock(page, 2000);
    await page.goto('/');

    const passphrase = page.getByLabel('Vault passphrase');
    await expect(passphrase).toBeVisible();
    await passphrase.fill(PASSPHRASE);

    const button = page.getByTestId('unlock-button');
    await button.click();

    // Without this the screen did not change at all, so clicking again was the
    // natural response — and each extra click queued another key derivation.
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(/Unlocking/);
    await expect(page.getByTestId('unlock-progress')).toBeVisible();
    await expect(passphrase).toBeDisabled();

    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('a second click cannot queue a second unlock', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/vault/unlock', async (route) => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.goto('/');
    await page.getByLabel('Vault passphrase').fill(PASSPHRASE);

    const button = page.getByTestId('unlock-button');
    await button.click();
    // Disabled, so these are no-ops — the guard is the point.
    await button.click({ force: true }).catch(() => undefined);
    await button.click({ force: true }).catch(() => undefined);

    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect(attempts).toBe(1);
  });

  test('recovers to a usable form after a wrong passphrase', async ({ page }) => {
    await page.goto('/');
    const passphrase = page.getByLabel('Vault passphrase');
    await expect(passphrase).toBeVisible();

    await passphrase.fill('definitely not the passphrase');
    await page.getByTestId('unlock-button').click();

    await expect(page.getByRole('alert')).toBeVisible();
    // Re-enabled, or a mistyped passphrase would strand the user on a dead form
    // with only a reload to escape.
    await expect(page.getByTestId('unlock-button')).toBeEnabled();
    await expect(passphrase).toBeEnabled();
  });
});

test.describe('US-5.1 Scenario: Year pickers offer the current period', () => {
  /** What the server says today is — the same source the pickers use. */
  async function periods(page: Page) {
    const response = await page.request.get('/api/reference/periods');
    return response.json() as Promise<{
      currentFinancialYear: string;
      currentAssessmentYear: string;
      currentCalendarYear: number;
      defaultFinancialYear: string;
      defaultCalendarYear: number;
      financialYears: { financialYear: string; assessmentYear: string }[];
    }>;
  }

  test('the Tax financial-year picker offers the current FY', async ({ page }) => {
    await unlock(page);
    const { currentFinancialYear } = await periods(page);

    await goToSection(page, 'Tax');
    // Offered, whether or not it is the default: a user looking for the year
    // they are in must be able to find it.
    await expect(
      page.getByLabel('Financial year').getByRole('option', { name: new RegExp(`FY ${currentFinancialYear}`) }),
    ).toHaveCount(1);
  });

  test('opens on a year that can actually be computed', async ({ page }) => {
    await unlock(page);
    const { defaultFinancialYear } = await periods(page);

    await goToSection(page, 'Tax');
    await expect(page.getByLabel('Financial year')).toHaveValue(defaultFinancialYear);

    // And the default must work: computing on first open must not error.
    await page.getByRole('button', { name: 'Compute advance tax' }).click();
    await expect(page.getByTestId('advance-tax-payable')).toContainText('₹');
  });

  test('shows the assessment year as FY + 1, never the FY repeated', async ({ page }) => {
    await unlock(page);
    const data = await periods(page);
    const selected = data.financialYears.find(
      (year) => year.financialYear === data.defaultFinancialYear,
    );
    expect(selected?.assessmentYear).not.toBe(selected?.financialYear);

    await goToSection(page, 'Tax');
    await expect(page.getByTestId('selected-period')).toContainText(
      `FY ${String(selected?.financialYear)} is assessed in AY ${String(selected?.assessmentYear)}`,
    );
  });

  test('the Compliance calendar-year picker offers the current year, flagged as running', async ({
    page,
  }) => {
    await unlock(page);
    const { currentCalendarYear, defaultCalendarYear } = await periods(page);

    await goToSection(page, 'Compliance');
    const picker = page.getByLabel('Calendar year');
    await expect(
      picker.getByRole('option', { name: new RegExp(String(currentCalendarYear)) }),
    ).toHaveCount(1);
    // Defaults to the last COMPLETE year — Schedule FA reports a 31-December
    // position that a running year has not reached.
    await expect(picker).toHaveValue(String(defaultCalendarYear));

    await picker.selectOption(String(currentCalendarYear));
    await expect(page.getByTestId('incomplete-calendar-year')).toContainText(
      String(currentCalendarYear),
    );
  });

  test('the Schedule AL picker offers the current financial year', async ({ page }) => {
    await unlock(page);
    const { currentFinancialYear, defaultFinancialYear } = await periods(page);

    await goToSection(page, 'Compliance');
    const picker = page.getByLabel('Financial year');
    await expect(
      picker.getByRole('option', { name: new RegExp(`FY ${currentFinancialYear}`) }),
    ).toHaveCount(1);
    await expect(picker).toHaveValue(defaultFinancialYear);
    await expect(page.getByTestId('al-assessment-year')).toContainText('AY');
  });
});

test.describe('US-4.6 Scenario: CSV templates are obtainable from the app', () => {
  test('lists a downloadable template for every manual asset class', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Import');

    const list = page.getByTestId('template-list');
    await expect(list).toBeVisible();
    for (const name of [
      'Custom_HandLoans',
      'Custom_RealEstate',
      'Custom_Cash',
      'Custom_ChitFunds',
      'Custom_UnlistedShares',
      'Custom_GenericBroker',
    ]) {
      await expect(list).toContainText(name);
    }
  });

  test('downloads a template whose header the importer accepts', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Import');

    const download = page.waitForEvent('download');
    await page.getByTestId('template-list').getByRole('link', { name: 'Download' }).first().click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Custom_HandLoans.csv');

    // The file must be usable as downloaded — guidance comments and all.
    const path = await file.path();
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('borrower_name,principal_amount');
    expect(contents).toContain('# Lines beginning with # are ignored on import');
  });

  test('imports a filled-in template as the asset class it declares', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Import');

    await page.getByLabel('Statement type').selectOption('TEMPLATE');
    await page.getByLabel('Statement file').setInputFiles({
      name: 'cash.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'account_label,as_of_date,balance,currency\nSalary account,2026-03-31,412500,INR\n',
      ),
    });
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByTestId('import-summary')).toBeVisible();
    // Nothing may land in "parsed but not applied" — that was the old behaviour.
    await expect(page.getByTestId('import-unapplied')).toHaveCount(0);

    await goToSection(page, 'Ledger');
    await expect(page.getByTestId('ledger-table')).toContainText('bank balance');
  });
});

test.describe('US-8.10 Scenario: Egress is visible and empty by default', () => {
  test('reports no outbound calls, and labels that as expected', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Settings');
    await expect(page.getByTestId('egress-log-empty')).toBeVisible();
  });
});
