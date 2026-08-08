/**
 * US-4.6 — standardised CSV templates, as a working import path.
 *
 * The previous coverage asserted `rows.length > 0` under the title "parses
 * borrower details, principal, interest rate and start date" — none of which it
 * checked. It passed against a parser that turned every template row into a
 * generic BUY with quantity 1 and discarded which template it had read, so a
 * hand loan and a bank balance were indistinguishable and neither could become
 * the asset it was.
 */
import { describe, it, expect } from 'vitest';
import { LedgerProjector, TemplateRegistry, TemplateParser, Pipeline } from '@porttrack/ingestion';
import { expectOk } from '@porttrack/test-kit';

const HAND_LOANS = [
  'borrower_name,principal_amount,interest_rate_pct,interest_basis,start_date,currency',
  'Rajesh Sharma,5000000,8.0,SIMPLE,2025-04-01,INR',
  'Priya Menon,1200000,9.5,SIMPLE,2025-07-15,INR',
].join('\n');

const REAL_ESTATE = [
  'property_name,purchase_date,purchase_price,stamp_duty,registration_fee,currency',
  'Whitefield flat,2024-06-10,9500000,570000,30000,INR',
].join('\n');

const CASH = ['account_label,as_of_date,balance,currency', 'Salary account,2026-03-31,412500,INR'].join(
  '\n',
);

describe('US-4.6 Scenario: A template is identified by its header', () => {
  it('recognises each template from its columns alone', () => {
    for (const template of TemplateRegistry.definitions()) {
      const csv = TemplateRegistry.generate(template.name);
      expect(TemplateRegistry.detect(csv)?.name).toBe(template.name);
    }
  });

  it('refuses a header that matches no template, naming what it saw', () => {
    const result = TemplateParser.parse('alpha,beta,gamma\n1,2,3\n', 'mystery.csv');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TEMPLATE_HEADER_MISMATCH');
      expect(result.error.message).toContain('alpha');
    }
  });

  it('does not match a template with an extra column', () => {
    // A subset match would silently ignore whatever the user added.
    const csv = `${HAND_LOANS.split('\n')[0] ?? ''},notes\nX,1,2,SIMPLE,2025-04-01,INR,hello\n`;
    expect(TemplateRegistry.detect(csv)).toBeUndefined();
  });
});

describe('US-4.6 Scenario: A downloaded template can be filled in and imported unchanged', () => {
  it('keeps its guidance comments out of the data', () => {
    const csv = TemplateRegistry.generate('Custom_Cash');
    expect(csv).toContain('# portTrack template: Custom_Cash');

    const filled = `${csv}Salary account,2026-03-31,412500,INR\n`;
    const rows = expectOk(TemplateParser.parse(filled, 'cash.csv'));
    // Six comment lines and one data row: exactly one transaction, not seven.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assetClass).toBe('BANK_BALANCE');
  });
});

describe('US-4.6 Scenario: Each template maps to its real asset class and fields', () => {
  it('parses borrower details, principal, interest rate and start date', () => {
    const rows = expectOk(TemplateParser.parse(HAND_LOANS, 'hand-loans.csv'));
    expect(rows).toHaveLength(2);

    const first = rows[0];
    expect(first?.assetClass).toBe('HAND_LOAN');
    expect(first?.pricePerUnit.amount).toBe('5000000');
    expect(first?.handLoan?.interestRatePct).toBe('8.0');
    expect(first?.handLoan?.interestBasis).toBe('SIMPLE');
    expect(first?.handLoan?.startDate).toBe('2025-04-01');
  });

  it('never carries the borrower\'s real name forward', () => {
    const rows = expectOk(TemplateParser.parse(HAND_LOANS, 'hand-loans.csv'));
    const serialised = JSON.stringify(rows);
    // The most identifying field in the product, belonging to someone who never
    // consented to being in a dataset.
    expect(serialised).not.toContain('Rajesh');
    expect(serialised).not.toContain('Sharma');
    expect(rows[0]?.handLoan?.borrowerRef).toMatch(/^brw_[0-9a-f]{16}$/);
  });

  it('adds stamp duty and registration to the cost of a property', () => {
    const rows = expectOk(TemplateParser.parse(REAL_ESTATE, 'property.csv'));
    expect(rows[0]?.assetClass).toBe('REAL_ESTATE');
    expect(rows[0]?.pricePerUnit.amount).toBe('9500000');
    expect(rows[0]?.otherCharges?.amount).toBe('570000');
    expect(rows[0]?.fees?.amount).toBe('30000');
  });

  it('reads a cash balance as a bank balance', () => {
    const rows = expectOk(TemplateParser.parse(CASH, 'cash.csv'));
    expect(rows[0]?.assetClass).toBe('BANK_BALANCE');
    expect(rows[0]?.pricePerUnit.amount).toBe('412500');
  });

  it('honours the currency column', () => {
    const csv = 'account_label,as_of_date,balance,currency\nUS savings,2026-03-31,5000,USD\n';
    const rows = expectOk(TemplateParser.parse(csv, 'cash.csv'));
    expect(rows[0]?.pricePerUnit.currency).toBe('USD');
  });
});

describe('US-4.6 Scenario: A bad cell is reported with its row and column', () => {
  it('rejects an unparseable interest basis without losing the good rows', async () => {
    const csv = [
      'borrower_name,principal_amount,interest_rate_pct,interest_basis,start_date,currency',
      'Good Borrower,100000,8,SIMPLE,2025-04-01,INR',
      'Bad Borrower,100000,8,WEEKLY,2025-04-01,INR',
    ].join('\n');

    const report = expectOk(
      await Pipeline.ingest({
        file: Buffer.from(csv),
        fileName: 'loans.csv',
        parser: 'TEMPLATE',
        mode: 'LENIENT',
      }),
    );

    expect(report.rejected).toBe(1);
    expect(report.errors[0]?.column).toBe('interest_basis');
    expect(report.errors[0]?.expectedFormat).toContain('SIMPLE');
    expect(report.created).toBe(1);
  });

  it('is atomic in STRICT mode', async () => {
    const csv = [
      'account_label,as_of_date,balance,currency',
      'Good,2026-03-31,1000,INR',
      'Bad,not-a-date,1000,INR',
    ].join('\n');

    const report = expectOk(
      await Pipeline.ingest({
        file: Buffer.from(csv),
        fileName: 'cash.csv',
        parser: 'TEMPLATE',
        mode: 'STRICT',
      }),
    );
    expect(report.committed).toBe(false);
    expect(report.created).toBe(0);
  });
});

describe('US-4.6 Scenario: Template rows become the right assets on the ledger', () => {
  it('builds a hand loan carrying its terms', () => {
    const rows = expectOk(TemplateParser.parse(HAND_LOANS, 'hand-loans.csv'));
    const projected = expectOk(LedgerProjector.project({ transactions: rows, parser: 'TEMPLATE' }));

    expect(projected.unapplied).toHaveLength(0);
    expect(projected.assets).toHaveLength(2);

    const loan = projected.assets[0];
    expect(loan?.assetClass).toBe('HAND_LOAN');
    expect(loan?.jurisdiction).toBe('DOMESTIC');
    expect(loan?.handLoan?.principal.amount).toBe('5000000');
    expect(loan?.handLoan?.interestBasis).toBe('SIMPLE');
    expect(loan?.handLoan?.startDate).toBe('2025-04-01');
  });

  it('builds a property whose cost includes duty and registration', () => {
    const rows = expectOk(TemplateParser.parse(REAL_ESTATE, 'property.csv'));
    const projected = expectOk(LedgerProjector.project({ transactions: rows, parser: 'TEMPLATE' }));

    const lot = projected.assets[0]?.lots[0];
    expect(projected.assets[0]?.assetClass).toBe('REAL_ESTATE');
    expect(lot?.otherCharges.amount).toBe('570000');
    expect(lot?.fees.amount).toBe('30000');
  });

  it('places each template on the ledger rather than rejecting it', () => {
    // The regression that prompted this: every TEMPLATE row came back unapplied
    // because the parser could not say what asset class it held.
    for (const template of TemplateRegistry.definitions()) {
      const header = TemplateRegistry.generate(template.name);
      const sample: Readonly<Record<string, string>> = {
        Custom_HandLoans: 'A Borrower,100000,8,SIMPLE,2025-04-01,INR',
        Custom_RealEstate: 'A flat,2024-06-10,9500000,570000,30000,INR',
        Custom_Cash: 'An account,2026-03-31,412500,INR',
        Custom_ChitFunds: 'A chit,2025-04-01,10000,24,INR',
        Custom_UnlistedShares: 'A company,2025-01-15,1000,250,INR',
        Custom_GenericBroker: '2025-01-01,ACME,INE000000001,buy,10,100,INR',
      };

      const rows = expectOk(
        TemplateParser.parse(`${header}${sample[template.name] ?? ''}\n`, `${template.name}.csv`),
      );
      const projected = expectOk(
        LedgerProjector.project({ transactions: rows, parser: 'TEMPLATE' }),
      );

      expect(projected.unapplied, `${template.name} produced unapplied rows`).toHaveLength(0);
      expect(projected.assets, `${template.name} produced no asset`).toHaveLength(1);
      expect(projected.assets[0]?.assetClass).toBe(template.assetClass);
    }
  });
});
