/**
 * Standardised CSV templates (US-4.6, PRD FR-4 AC).
 *
 * The escape hatch for everything with no broker export: hand loans, property,
 * cash, chit funds, unlisted shares. A header mismatch names exactly which
 * columns are missing and which were unexpected — "invalid CSV" is useless to
 * someone editing a spreadsheet.
 *
 * **Each template declares the asset class it holds, and the parser identifies
 * the template from its header.** The earlier version read every template
 * through one generic path: it guessed a date column, guessed an amount column,
 * emitted `BUY` with quantity 1, and discarded which template it had read. A
 * hand loan and a bank balance came out identical and neither could become the
 * asset it actually was. Asset class drives tax treatment, so a template that
 * cannot say what it holds is worse than no template.
 */
import {
  Err,
  Money,
  Ok,
  TemplateHeaderMismatchError,
  type Money as MoneyValue,
  type Result,
} from '@porttrack/shared-kernel';
import { normaliseDate, parseCsv, type CsvRow, type CsvTable } from './csv.js';
import { borrowerRef, deterministicImportedAt, provenanceFor } from './provenance.js';
import type { ParsedLoanPayment, ParsedTransaction, RowError } from './types.js';

export interface TemplateDefinition {
  readonly name: string;
  readonly columns: readonly string[];
  readonly description: string;
  /** What a row in this template becomes. Stated, never inferred. */
  readonly assetClass: string;
  /** Shown above the header when the file is downloaded, as a `#` comment. */
  readonly guidance: string;
}

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    name: 'Custom_HandLoans',
    columns: [
      // Facts the lender records.
      'borrower_name',
      'notes',
      'loan_date',
      'closed_date',
      'loan_amount',
      'interest_rate_pct',
      'currency',
      'status',
      // Principal coming back. Interest accrues only on what remains after each.
      'principal_repayment_1',
      'principal_date_1',
      'principal_repayment_2',
      'principal_date_2',
      // Interest received. These do NOT reduce the principal.
      'interest_payment_1',
      'date_1',
      'interest_payment_2',
      'date_2',
      'interest_payment_3',
      'date_3',
      'interest_payment_4',
      'date_4',
      // Derived. Accepted so an existing sheet pastes in unchanged, then
      // recomputed — see `guidance`.
      'total_interest_months',
      'interest_balance_months',
      'interest_per_month',
      'total_overall_interest',
      'interest_balance',
    ],
    description: 'Money lent to friends or family, with interest and repayment history',
    assetClass: 'HAND_LOAN',
    guidance:
      'status is Active, Partially Repaid or Repaid — it is RECOMPUTED from the repayment ' +
      'columns, and so are total_interest_months, interest_balance_months, interest_per_month, ' +
      'total_overall_interest and interest_balance. Those five are accepted so an existing ' +
      'spreadsheet pastes in unchanged; where a figure disagrees with the computed one the ' +
      'import reports it rather than overwriting either. Interest accrues on the DECLINING ' +
      'balance on a 30/360 basis, so a principal repayment reduces what earns from its date. ' +
      'Leave unused payment columns blank. The borrower name is stored encrypted in your vault ' +
      'and is replaced by an opaque reference in anything that leaves this machine.',
  },
  {
    name: 'Custom_RealEstate',
    columns: [
      'property_name',
      'purchase_date',
      'purchase_price',
      'stamp_duty',
      'registration_fee',
      'currency',
    ],
    description: 'Land and buildings, at cost of acquisition',
    assetClass: 'REAL_ESTATE',
    guidance:
      'Stamp duty and registration fee are added to the cost of acquisition, which is what ' +
      'Schedule AL reports. Enter the purchase price, not a current valuation.',
  },
  {
    name: 'Custom_Cash',
    columns: ['account_label', 'as_of_date', 'balance', 'currency'],
    description: 'Cash in hand and bank balances',
    assetClass: 'BANK_BALANCE',
    guidance:
      'One row per account. account_label is your own reference, e.g. "Salary account" — ' +
      'do not enter the account number.',
  },
  {
    name: 'Custom_ChitFunds',
    columns: ['scheme_name', 'start_date', 'monthly_instalment', 'total_months', 'currency'],
    description: 'Chit funds and family savings schemes',
    assetClass: 'CHIT_FUND',
    guidance:
      'Recorded as total_months instalments at monthly_instalment, i.e. the TOTAL COMMITTED ' +
      'amount at cost. A chit fund\'s realisable value depends on auction history this ' +
      'template does not capture, so treat the figure as commitment, not market value.',
  },
  {
    name: 'Custom_UnlistedShares',
    columns: ['company_name', 'acquisition_date', 'quantity', 'price_per_share', 'currency'],
    description: 'Unlisted and private company shares',
    assetClass: 'UNLISTED_SHARES',
    guidance:
      'Unlisted shares have no published price, so they are valued at cost until you record ' +
      'a disposal.',
  },
  {
    name: 'Custom_GenericBroker',
    columns: ['trade_date', 'symbol', 'isin', 'trade_type', 'quantity', 'price', 'currency'],
    description: 'Any broker without a dedicated parser',
    assetClass: 'DOMESTIC_EQUITY',
    guidance: 'trade_type is buy or sell. Sells consume lots FIFO, oldest first.',
  },
];

const byName = new Map(TEMPLATES.map((template) => [template.name, template]));

export const listTemplates = (): readonly string[] => TEMPLATES.map((t) => t.name);

export const templateDefinitions = (): readonly TemplateDefinition[] => TEMPLATES;

/**
 * A downloadable CSV: guidance as comment lines, then the header row.
 *
 * The comments are stripped on import, so the file a user downloads is the file
 * they can fill in and upload without deleting anything first.
 */
export function generateTemplate(name: string): string {
  const template = byName.get(name);
  if (template === undefined) return '';

  // `parseCsv` already drops `#` lines, so a downloaded template can be filled
  // in and uploaded without deleting the guidance first.
  const comments = [
    `# portTrack template: ${template.name}`,
    `# ${template.description}`,
    ...wrap(template.guidance, 88).map((line) => `# ${line}`),
    '#',
    '# Lines beginning with # are ignored on import. Keep the header row exactly as it is.',
  ];
  return `${comments.join('\n')}\n${template.columns.join(',')}\n`;
}

function wrap(text: string, width: number): readonly string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current.length === 0 ? word : `${current} ${word}`;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

export function validateHeaders(csv: string, templateName: string): Result<void> {
  const template = byName.get(templateName);
  if (template === undefined) {
    return Err(new TemplateHeaderMismatchError(`unknown template "${templateName}"`));
  }

  const { header } = parseCsv(csv);
  const missing = template.columns.filter((column) => !header.includes(column));
  const unexpected = header.filter((column) => !template.columns.includes(column));

  if (missing.length > 0 || unexpected.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing column(s): ${missing.join(', ')}`);
    if (unexpected.length > 0) parts.push(`unexpected column(s): ${unexpected.join(', ')}`);
    return Err(
      new TemplateHeaderMismatchError(
        `${templateName} template header mismatch — ${parts.join('; ')}`,
        missing,
        unexpected,
      ),
    );
  }
  return Ok(undefined);
}

/**
 * Which template this file is, decided by its header alone.
 *
 * Exact set match, not a subset: a file with the hand-loan columns plus an extra
 * one is not a hand-loan template, and importing it as one would silently ignore
 * whatever the user added.
 */
export function detectTemplate(csv: string): TemplateDefinition | undefined {
  const { header } = parseCsv(csv);
  const found = new Set(header);
  return TEMPLATES.find(
    (template) =>
      template.columns.length === found.size &&
      template.columns.every((column) => found.has(column)),
  );
}

/* ------------------------------------------------------------------ parsing */

const NUMBER = /^-?\d+(\.\d+)?$/;

interface Reader {
  readonly cell: (name: string) => string;
  readonly rowNumber: number;
}

function readerFor(table: CsvTable, row: CsvRow): Reader {
  return {
    cell: (name: string) => (row.cells[table.header.indexOf(name)] ?? '').trim(),
    rowNumber: row.rowNumber,
  };
}

type RowResult = { txn: ParsedTransaction } | { error: RowError };

const invalid = (
  reader: Reader,
  column: string,
  value: string,
  reason: string,
  expectedFormat: string,
): RowResult => ({
  error: { row: reader.rowNumber, column, value, reason, expectedFormat },
});

function requireDate(reader: Reader, column: string): string | RowResult {
  const raw = reader.cell(column);
  const date = normaliseDate(raw);
  if (date === undefined) {
    return invalid(reader, column, raw, 'not a recognisable date', 'YYYY-MM-DD');
  }
  return date;
}

function requireNumber(reader: Reader, column: string): string | RowResult {
  const raw = reader.cell(column);
  if (!NUMBER.test(raw)) {
    return invalid(reader, column, raw, 'not a valid number', 'a decimal such as 125000.50');
  }
  return raw;
}

const isRowResult = (value: string | RowResult): value is RowResult => typeof value !== 'string';

const isRowError = (value: unknown): value is RowResult =>
  typeof value === 'object' && value !== null && 'error' in value;

/** A date column that may legitimately be blank — an open loan has no closing date. */
function optionalDate(reader: Reader, column: string): string | undefined | RowResult {
  const raw = reader.cell(column);
  if (raw.length === 0) return undefined;
  const date = normaliseDate(raw);
  if (date === undefined) {
    return invalid(reader, column, raw, 'not a recognisable date', 'YYYY-MM-DD');
  }
  return date;
}

/**
 * The status a spreadsheet stated. Returned for reconstruction only — status is
 * DERIVED from repayments, so a stale cell can never override the arithmetic.
 */
function parseStatus(
  raw: string,
): 'ACTIVE' | 'PARTIALLY_REPAID' | 'REPAID' | undefined | 'INVALID' {
  const normalised = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalised.length === 0) return undefined;
  if (normalised === 'ACTIVE' || normalised === 'OPEN') return 'ACTIVE';
  if (normalised === 'REPAID' || normalised === 'CLOSED') return 'REPAID';
  if (normalised === 'PARTIALLY_REPAID' || normalised === 'PARTIAL') return 'PARTIALLY_REPAID';
  return 'INVALID';
}

/**
 * Reads the fixed amount/date column pairs a spreadsheet uses for payments.
 *
 * A blank pair is skipped; an amount without its date, or a date without its
 * amount, is an error rather than a guess — a payment missing its date cannot
 * be placed on the accrual timeline, and placing it wrongly changes the interest.
 */
function collectPayments(
  reader: Reader,
  currency: Parameters<typeof Money.of>[1],
  pairs: readonly (readonly [string, string])[],
): readonly ParsedLoanPayment[] | RowResult {
  const payments: ParsedLoanPayment[] = [];

  for (const [amountColumn, dateColumn] of pairs) {
    const rawAmount = reader.cell(amountColumn);
    const rawDate = reader.cell(dateColumn);
    if (rawAmount.length === 0 && rawDate.length === 0) continue;

    if (rawAmount.length === 0) {
      return invalid(reader, amountColumn, '', 'a date was given without an amount', 'an amount');
    }
    if (!NUMBER.test(rawAmount)) {
      return invalid(reader, amountColumn, rawAmount, 'not a valid number', 'a decimal amount');
    }
    if (rawDate.length === 0) {
      return invalid(reader, dateColumn, '', 'an amount was given without a date', 'YYYY-MM-DD');
    }
    const date = normaliseDate(rawDate);
    if (date === undefined) {
      return invalid(reader, dateColumn, rawDate, 'not a recognisable date', 'YYYY-MM-DD');
    }

    payments.push({ date, amount: Money.of(rawAmount, currency) });
  }

  return payments;
}

/** Optional money column; absent or blank contributes zero rather than failing. */
function optionalMoney(reader: Reader, column: string, currency: string): MoneyValue {
  const raw = reader.cell(column);
  return Money.of(NUMBER.test(raw) ? raw : '0', currency as Parameters<typeof Money.of>[1]);
}

function currencyOf(reader: Reader): Parameters<typeof Money.of>[1] {
  const raw = reader.cell('currency').toUpperCase();
  return (raw.length === 0 ? 'INR' : raw) as Parameters<typeof Money.of>[1];
}

function mapRow(
  template: TemplateDefinition,
  reader: Reader,
  fileName: string,
  importedAt: string,
): RowResult {
  const provenance = provenanceFor(fileName, reader.rowNumber, 'TEMPLATE', importedAt);
  const currency = currencyOf(reader);
  const base = { assetClass: template.assetClass, provenance } as const;

  switch (template.name) {
    case 'Custom_HandLoans': {
      const loanDate = requireDate(reader, 'loan_date');
      if (isRowResult(loanDate)) return loanDate;
      const principal = requireNumber(reader, 'loan_amount');
      if (isRowResult(principal)) return principal;
      const rate = requireNumber(reader, 'interest_rate_pct');
      if (isRowResult(rate)) return rate;

      const name = reader.cell('borrower_name');
      if (name.length === 0) {
        return invalid(reader, 'borrower_name', '', 'a borrower is required', 'a name');
      }

      const closedDate = optionalDate(reader, 'closed_date');
      if (isRowError(closedDate)) return closedDate;

      const declaredStatus = parseStatus(reader.cell('status'));
      if (declaredStatus === 'INVALID') {
        return invalid(
          reader,
          'status',
          reader.cell('status'),
          'unrecognised status',
          'Active, Partially Repaid or Repaid',
        );
      }

      const principalRepayments = collectPayments(reader, currency, [
        ['principal_repayment_1', 'principal_date_1'],
        ['principal_repayment_2', 'principal_date_2'],
      ]);
      if (isRowError(principalRepayments)) return principalRepayments;

      const interestPayments = collectPayments(reader, currency, [
        ['interest_payment_1', 'date_1'],
        ['interest_payment_2', 'date_2'],
        ['interest_payment_3', 'date_3'],
        ['interest_payment_4', 'date_4'],
      ]);
      if (isRowError(interestPayments)) return interestPayments;

      const notes = reader.cell('notes');

      return {
        txn: {
          ...base,
          kind: 'BUY',
          date: loanDate,
          // The OPAQUE reference identifies the asset; the name travels only in
          // the handLoan block, which is stored encrypted and never exported raw.
          symbol: borrowerRef(name),
          quantity: '1',
          pricePerUnit: Money.of(principal, currency),
          handLoan: {
            borrowerRef: borrowerRef(name),
            borrowerName: name,
            interestRatePct: rate,
            interestBasis: 'SIMPLE',
            startDate: loanDate,
            ...(closedDate === undefined ? {} : { closedDate }),
            ...(notes.length === 0 ? {} : { notes }),
            principalRepayments,
            interestPayments,
            ...(declaredStatus === undefined ? {} : { declaredStatus }),
          },
        },
      };
    }

    case 'Custom_RealEstate': {
      const date = requireDate(reader, 'purchase_date');
      if (isRowResult(date)) return date;
      const price = requireNumber(reader, 'purchase_price');
      if (isRowResult(price)) return price;

      const name = reader.cell('property_name');
      if (name.length === 0) {
        return invalid(reader, 'property_name', '', 'a property name is required', 'a label');
      }

      return {
        txn: {
          ...base,
          kind: 'BUY',
          date,
          symbol: name,
          quantity: '1',
          pricePerUnit: Money.of(price, currency),
          // Both are part of the cost of acquisition, which is what Schedule AL
          // reports — omitting them would understate the disclosed cost.
          fees: optionalMoney(reader, 'registration_fee', currency),
          otherCharges: optionalMoney(reader, 'stamp_duty', currency),
        },
      };
    }

    case 'Custom_Cash': {
      const date = requireDate(reader, 'as_of_date');
      if (isRowResult(date)) return date;
      const balance = requireNumber(reader, 'balance');
      if (isRowResult(balance)) return balance;

      const label = reader.cell('account_label');
      if (label.length === 0) {
        return invalid(reader, 'account_label', '', 'an account label is required', 'a label');
      }

      return {
        txn: {
          ...base,
          kind: 'BUY',
          date,
          symbol: label,
          quantity: '1',
          pricePerUnit: Money.of(balance, currency),
        },
      };
    }

    case 'Custom_ChitFunds': {
      const date = requireDate(reader, 'start_date');
      if (isRowResult(date)) return date;
      const instalment = requireNumber(reader, 'monthly_instalment');
      if (isRowResult(instalment)) return instalment;
      const months = requireNumber(reader, 'total_months');
      if (isRowResult(months)) return months;

      return {
        txn: {
          ...base,
          kind: 'BUY',
          date,
          symbol: reader.cell('scheme_name'),
          // Total committed, at cost. See this template's `guidance`.
          quantity: months,
          pricePerUnit: Money.of(instalment, currency),
        },
      };
    }

    case 'Custom_UnlistedShares': {
      const date = requireDate(reader, 'acquisition_date');
      if (isRowResult(date)) return date;
      const quantity = requireNumber(reader, 'quantity');
      if (isRowResult(quantity)) return quantity;
      const price = requireNumber(reader, 'price_per_share');
      if (isRowResult(price)) return price;

      return {
        txn: {
          ...base,
          kind: 'BUY',
          date,
          symbol: reader.cell('company_name'),
          quantity,
          pricePerUnit: Money.of(price, currency),
        },
      };
    }

    default: {
      const date = requireDate(reader, 'trade_date');
      if (isRowResult(date)) return date;
      const quantity = requireNumber(reader, 'quantity');
      if (isRowResult(quantity)) return quantity;
      const price = requireNumber(reader, 'price');
      if (isRowResult(price)) return price;

      const side = reader.cell('trade_type').toLowerCase();
      if (side !== 'buy' && side !== 'sell') {
        return invalid(
          reader,
          'trade_type',
          reader.cell('trade_type'),
          'unrecognised trade type',
          'buy or sell',
        );
      }

      const isin = reader.cell('isin');
      const symbol = reader.cell('symbol');
      return {
        txn: {
          ...base,
          kind: side === 'buy' ? 'BUY' : 'SELL',
          date,
          ...(symbol.length === 0 ? {} : { symbol }),
          ...(isin.length === 0 ? {} : { isin }),
          quantity,
          pricePerUnit: Money.of(price, currency),
        },
      };
    }
  }
}

export interface TemplateParseOutcome {
  readonly transactions: readonly ParsedTransaction[];
  readonly errors: readonly RowError[];
  readonly template?: TemplateDefinition;
}

/**
 * @param expected the template the user SAID they were importing, if they said.
 *
 * Naming it buys a far better error. Detection can only report "this matches
 * nothing"; a declared template can be diffed against the file and report
 * exactly which columns are missing and which were not expected — which is what
 * someone editing a spreadsheet can actually act on. It also catches choosing
 * Cash and uploading Hand Loans, which would otherwise import silently and
 * correctly as the wrong thing.
 */
export function parseTemplateFile(
  csv: string,
  fileName: string,
  expected?: string,
): Result<TemplateParseOutcome> {
  if (expected !== undefined && expected.length > 0) {
    const declared = byName.get(expected);
    if (declared === undefined) {
      return Err(new TemplateHeaderMismatchError(`unknown template "${expected}"`));
    }
    const valid = validateHeaders(csv, expected);
    if (!valid.ok) return valid;
  }

  const template = detectTemplate(csv);
  if (template === undefined) {
    const { header } = parseCsv(csv);
    return Err(
      new TemplateHeaderMismatchError(
        `this header matches no portTrack template: ${header.join(', ')}. ` +
          `Download a template from the Import screen and keep its header row unchanged.`,
        [],
        header,
      ),
    );
  }

  const table = parseCsv(csv);
  const importedAt = deterministicImportedAt(fileName);
  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];

  for (const row of table.rows) {
    const result = mapRow(template, readerFor(table, row), fileName, importedAt);
    if ('error' in result) errors.push(result.error);
    else transactions.push(result.txn);
  }

  return Ok({ transactions, errors, template });
}

/** Backwards-compatible shape: transactions only, errors dropped. */
export function parseTemplate(csv: string, fileName: string): Result<readonly ParsedTransaction[]> {
  const parsed = parseTemplateFile(csv, fileName);
  return parsed.ok ? Ok(parsed.value.transactions) : parsed;
}
