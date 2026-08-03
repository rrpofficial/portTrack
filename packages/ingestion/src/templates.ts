/**
 * Standardised CSV templates (US-4.6, PRD FR-4 AC).
 *
 * The escape hatch for everything with no broker export: hand loans, property,
 * cash, chit funds, unlisted shares. A header mismatch names exactly which
 * columns are missing and which were unexpected — "invalid CSV" is useless to
 * someone editing a spreadsheet.
 */
import { Err, Money, Ok, TemplateHeaderMismatchError, type Result } from '@porttrack/shared-kernel';
import { normaliseDate, parseCsv } from './csv.js';
import { deterministicImportedAt, provenanceFor } from './provenance.js';
import type { ParsedTransaction } from './types.js';

export interface TemplateDefinition {
  readonly name: string;
  readonly columns: readonly string[];
  readonly description: string;
}

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    name: 'Custom_HandLoans',
    columns: ['borrower_name', 'principal_amount', 'interest_rate_pct', 'interest_basis', 'start_date', 'currency'],
    description: 'Money lent to friends or family, with interest terms',
  },
  {
    name: 'Custom_RealEstate',
    columns: ['property_name', 'purchase_date', 'purchase_price', 'stamp_duty', 'registration_fee', 'currency'],
    description: 'Land and buildings, at cost of acquisition',
  },
  {
    name: 'Custom_Cash',
    columns: ['account_label', 'as_of_date', 'balance', 'currency'],
    description: 'Cash in hand and bank balances',
  },
  {
    name: 'Custom_ChitFunds',
    columns: ['scheme_name', 'start_date', 'monthly_instalment', 'total_months', 'currency'],
    description: 'Chit funds and family savings schemes',
  },
  {
    name: 'Custom_UnlistedShares',
    columns: ['company_name', 'acquisition_date', 'quantity', 'price_per_share', 'currency'],
    description: 'Unlisted and private company shares',
  },
  {
    name: 'Custom_GenericBroker',
    columns: ['trade_date', 'symbol', 'isin', 'trade_type', 'quantity', 'price', 'currency'],
    description: 'Any broker without a dedicated parser',
  },
];

const byName = new Map(TEMPLATES.map((template) => [template.name, template]));

export const listTemplates = (): readonly string[] => TEMPLATES.map((t) => t.name);

/** A downloadable, empty CSV with the correct header row. */
export function generateTemplate(name: string): string {
  const template = byName.get(name);
  if (template === undefined) return '';
  return `${template.columns.join(',')}\n`;
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

/** Generic template reader; the asset-specific mapping happens in app-services. */
export function parseTemplate(csv: string, fileName: string): Result<readonly ParsedTransaction[]> {
  const table = parseCsv(csv);
  const importedAt = deterministicImportedAt(fileName);
  const rows: ParsedTransaction[] = [];

  const dateColumn = table.header.find((column) => column.endsWith('_date'));
  const amountColumn = table.header.find(
    (column) => column.includes('amount') || column.includes('price') || column.includes('balance'),
  );

  for (const row of table.rows) {
    const rawDate = dateColumn === undefined ? '' : (row.cells[table.header.indexOf(dateColumn)] ?? '');
    const amount =
      amountColumn === undefined ? '0' : (row.cells[table.header.indexOf(amountColumn)] ?? '0');
    rows.push({
      kind: 'BUY',
      date: normaliseDate(rawDate) ?? rawDate,
      quantity: '1',
      pricePerUnit: Money.of(amount, 'INR'),
      provenance: provenanceFor(fileName, row.rowNumber, 'TEMPLATE', importedAt),
    });
  }
  return Ok(rows);
}
