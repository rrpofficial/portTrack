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
  'Loans',
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
    expect(contents).toContain('borrower_name,notes,loan_date');
    expect(contents).toContain('# Lines beginning with # are ignored on import');
  });

  test('offers a template dropdown once portTrack CSV template is chosen', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Import');

    // Absent for a broker statement — there is no template to choose.
    await expect(page.getByLabel('Template', { exact: true })).toHaveCount(0);

    await page.getByLabel('Statement type').selectOption('TEMPLATE');
    const picker = page.getByLabel('Template', { exact: true });
    await expect(picker).toBeVisible();

    for (const name of [
      'Custom_HandLoans',
      'Custom_RealEstate',
      'Custom_Cash',
      'Custom_ChitFunds',
      'Custom_UnlistedShares',
      'Custom_GenericBroker',
    ]) {
      await expect(picker.getByRole('option', { name: new RegExp(name) })).toHaveCount(1);
    }

    // Choosing one explains what it records and offers that exact file.
    await picker.selectOption('Custom_Cash');
    const hint = page.getByTestId('template-hint');
    await expect(hint).toContainText('bank balance');
    await expect(hint.getByRole('link', { name: 'Download this template' })).toBeVisible();
  });

  test('says which columns are wrong when the chosen template does not match', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Import');

    await page.getByLabel('Statement type').selectOption('TEMPLATE');
    await page.getByLabel('Template', { exact: true }).selectOption('Custom_Cash');
    await page.getByLabel('Statement file').setInputFiles({
      name: 'cash.csv',
      mimeType: 'text/csv',
      // `balance` is missing.
      buffer: Buffer.from('account_label,as_of_date,currency\nSavings,2026-03-31,INR\n'),
    });
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('balance');
    await expect(alert).toContainText('Custom_Cash');
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

test.describe('US-1.11 Scenario: The hand-loan register, end to end', () => {
  /*
   * Fixed and distinct per test, so one test's loans cannot satisfy another's
   * assertions. Deliberately NOT seeded from the clock: recording the same terms
   * twice is idempotent, so a re-run against an existing vault is harmless, and
   * a test that reads the wall clock is not reproducible.
   */
  const BORROWERS = {
    journey: 'E2E Journey Borrower',
    filter: 'E2E Filter Borrower',
    export: 'E2E Export Borrower',
    dashboard: 'E2E Dashboard Borrower',
  } as const;

  async function lend(
    page: Page,
    name: string,
    amount: string,
    rate = '12',
    date = '2025-04-01',
  ): Promise<void> {
    await page.getByRole('button', { name: 'Record a loan' }).click();
    const form = page.getByTestId('new-loan-form');
    await form.getByLabel('Borrower name').fill(name);
    await form.getByLabel('Loan amount').fill(amount);
    await form.getByLabel('Interest rate %').fill(rate);
    await form.getByLabel('Loan date').fill(date);
    await form.getByRole('button', { name: 'Save loan' }).click();
    await expect(page.getByTestId('loan-table')).toContainText(name);
  }

  test('records a loan, takes interest, then takes part of the principal back', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');

    const name = BORROWERS.journey;
    await lend(page, name, '1200000');

    // Open the loan's detail.
    await page.getByRole('button', { name, exact: true }).click();
    const detail = page.locator('[data-testid^="loan-detail-"]');
    await expect(detail).toBeVisible();

    /* --------------------------------------------------- interest payment */
    const interestForm = page.locator('[data-testid^="interest-form-"]');
    await interestForm.getByLabel('Amount').fill('36000');
    await interestForm.getByLabel('Date').fill('2025-07-01');
    await interestForm.getByRole('button', { name: 'Record interest' }).click();

    // The detail stays open across the reload; clicking the borrower again
    // would toggle it shut.
    await expect(page.locator('[data-testid^="loan-detail-"]')).toContainText('36,000');
    // Interest must NOT have reduced the principal.
    await expect(page.getByTestId('loan-table')).toContainText('12,00,000');

    /* ------------------------------------------------ principal repayment */
    const principalForm = page.locator('[data-testid^="principal-form-"]');
    await principalForm.getByLabel('Amount').fill('600000');
    await principalForm.getByLabel('Date').fill('2025-10-01');
    await principalForm.getByRole('button', { name: 'Record repayment' }).click();

    // Status follows the principal, and outstanding halves.
    await expect(page.getByTestId('loan-table')).toContainText('Partially repaid');
    await expect(page.getByTestId('loan-table')).toContainText('6,00,000');
  });

  test('splits pending interest between live loans and repaid principal', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');

    // Both tiles exist and are distinguishable — the whole point of the split.
    await expect(page.getByTestId('tile-pending-active')).toBeVisible();
    await expect(page.getByTestId('tile-pending-repaid')).toBeVisible();
    await expect(page.getByTestId('tile-total-lent')).toContainText('₹');
    await expect(page.getByTestId('tile-outstanding')).toContainText('₹');
  });

  test('filters by status and by borrower, and re-totals as it goes', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');

    const name = BORROWERS.filter;
    await lend(page, name, '750000');

    const table = page.getByTestId('loan-table');
    await expect(table).toContainText(name);

    // A status the loan cannot have empties the table...
    await page.getByRole('checkbox', { name: 'Repaid', exact: true }).check();
    await expect(table).not.toContainText(name);

    // ...and clearing it brings the loan back. "No filter" means all, not none.
    await page.getByRole('checkbox', { name: 'Repaid', exact: true }).uncheck();
    await expect(table).toContainText(name);

    // By id: every borrower CHECKBOX is labelled with a name, and those names
    // contain the word "Borrower", so a by-label lookup is ambiguous here.
    await page.locator('#borrower-search').fill('nobody-by-this-name');
    await expect(page.getByTestId('loan-empty')).toBeVisible();
    await expect(page.getByTestId('tile-total-lent')).toContainText('₹0');
  });

  test('filters by borrower through a dropdown, not a checkbox per person', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');

    const name = BORROWERS.filter;
    await lend(page, name, '750000');

    // A checkbox per borrower is unusable once there are many; the list is a
    // dropdown and each choice becomes a removable chip.
    await page.getByLabel('Add', { exact: true }).selectOption(name);
    await expect(page.getByTestId('borrower-chips')).toContainText(name);
    await expect(page.getByTestId('loan-table')).toContainText(name);

    // The chosen borrower leaves the dropdown, so they cannot be added twice.
    await expect(
      page.getByLabel('Add', { exact: true }).getByRole('option', { name, exact: true }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: `Remove ${name} from the filter` }).click();
    await expect(page.getByTestId('borrower-chips')).toHaveCount(0);
  });

  test('shows loans in the Ledger as receivables, not as empty holdings', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');
    await lend(page, BORROWERS.journey, '1200000');

    await goToSection(page, 'Ledger');
    const receivables = page.getByTestId('loans-receivable-table');
    await expect(receivables).toBeVisible();

    // The borrower's name, not the raw asset id it used to fall back to.
    await expect(receivables).toContainText(BORROWERS.journey);
    await expect(receivables).not.toContainText('ast_hand_loan_');

    // And a loan must never appear in Holdings, where every column is
    // meaningless for a receivable: 0 lots, 0 held, ₹0 cost.
    const holdings = page.getByTestId('ledger-table');
    if ((await holdings.count()) > 0) {
      await expect(holdings).not.toContainText(BORROWERS.journey);
    }
  });

  test('a loan recorded now shows on the Dashboard without a reload', async ({ page }) => {
    await unlock(page);

    await goToSection(page, 'Dashboard');
    const netWorth = page.getByTestId('net-worth');
    const before = (await netWorth.textContent()) ?? '';

    await goToSection(page, 'Loans');
    await lend(page, BORROWERS.dashboard, '500000');

    await goToSection(page, 'Dashboard');
    /*
     * The exact reported failure: the valuation was fetched once at unlock, so
     * the Dashboard sat at ₹0 while Loans and Ledger showed the money. Opening
     * the tab must re-value.
     */
    await expect(netWorth).not.toHaveText(before);
    await expect(page.getByTestId('allocation-breakdown')).toContainText('hand loan');
  });

  test('says when it was valued, rather than claiming to be live', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Dashboard');

    // A "Live" badge asserted freshness the screen did not have.
    await expect(page.getByTestId('revalue')).toContainText(/as at|Refresh/);
    await page.getByTestId('revalue').click();
    await expect(page.getByTestId('revalue')).toContainText(/as at/);
  });

  test('sorts by each field the register offers', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');

    for (const option of ['Borrower', 'Status', 'Loan date', 'Amount']) {
      await page.getByLabel('Sort by').selectOption({ label: option });
      await expect(page.getByTestId('loan-table')).toBeVisible();
    }
    // Direction toggles rather than being a second control to forget.
    await page.getByRole('button', { name: 'Descending' }).click();
    await expect(page.getByRole('button', { name: 'Ascending' })).toBeVisible();
  });

  test('exports the register as CSV and as PDF', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Loans');
    await lend(page, BORROWERS.export, '250000');

    const csv = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV' }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toBe('hand-loans.csv');
    const csvText = readFileSync(await csvFile.path(), 'utf8');
    expect(csvText).toContain('Borrower Name');
    expect(csvText).toContain('PENDING INTEREST — PRINCIPAL REPAID');

    const pdf = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export PDF' }).click();
    const pdfFile = await pdf;
    expect(pdfFile.suggestedFilename()).toBe('hand-loans.pdf');
    const pdfBytes = readFileSync(await pdfFile.path());
    // A real PDF, not an error page with a .pdf name.
    expect(pdfBytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdfBytes.toString('latin1')).toContain('Hand Loan Register');
  });
});

test.describe('US-4.6 Scenario: The hand-loan template carries the full register', () => {
  test('imports a spreadsheet with payments and repayment history', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Import');

    const header = await page.evaluate(async () => {
      const response = await fetch('/api/templates');
      const body = (await response.json()) as {
        templates: { name: string; columns: string[] }[];
      };
      return body.templates.find((t) => t.name === 'Custom_HandLoans')?.columns.join(',') ?? '';
    });
    expect(header).toContain('interest_payment_1');
    expect(header).toContain('principal_repayment_1');
    expect(header).toContain('closed_date');

    const name = 'E2E Sheet Import Borrower';
    const row =
      `${name},House deposit,2025-04-01,,1200000,12,INR,Partially Repaid,` +
      `600000,2025-10-01,,,36000,2025-07-01,,,,,,,,,,,`;

    await page.getByLabel('Statement type').selectOption('TEMPLATE');
    await page.getByLabel('Statement file').setInputFiles({
      name: 'loans.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${header}\n${row}\n`),
    });
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByTestId('import-summary')).toBeVisible();
    await expect(page.getByTestId('import-unapplied')).toHaveCount(0);

    // The imported history must reach the register, not just the ledger.
    await goToSection(page, 'Loans');
    const table = page.getByTestId('loan-table');
    await expect(table).toContainText(name);
    await expect(table).toContainText('Partially repaid');
    await expect(table).toContainText('6,00,000');
  });
});

test.describe('US-8.10 Scenario: Egress is visible and empty by default', () => {
  test('reports no outbound calls, and labels that as expected', async ({ page }) => {
    await unlock(page);
    await goToSection(page, 'Settings');
    await expect(page.getByTestId('egress-log-empty')).toBeVisible();
  });
});
