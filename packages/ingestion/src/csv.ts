/**
 * Minimal RFC 4180 CSV reader.
 *
 * Hand-rolled rather than pulled from a dependency because broker exports are
 * small, the surface needed is tiny, and every parser here must report the
 * ORIGINAL row number of a bad cell (US-4.8) — which most streaming readers make
 * awkward once blank lines and comments have been filtered out.
 */
export interface CsvRow {
  readonly cells: readonly string[];
  /** 1-based index among DATA rows, excluding the header and comments. */
  readonly rowNumber: number;
}

export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly CsvRow[];
}

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? '';
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

export function parseCsv(text: string): CsvTable {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));

  const [headerLine, ...dataLines] = lines;
  return {
    header: headerLine === undefined ? [] : splitLine(headerLine).map((h) => h.toLowerCase()),
    rows: dataLines.map((line, index) => ({ cells: splitLine(line), rowNumber: index + 1 })),
  };
}

export const columnIndex = (header: readonly string[], name: string): number =>
  header.indexOf(name.toLowerCase());

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts ISO and the `10-Apr-2025` form brokers and CAS statements use. */
export function normaliseDate(raw: string): string | undefined {
  const value = raw.trim();
  if (ISO_DATE.test(value)) {
    const [, month, day] = value.split('-').map(Number);
    if (month === undefined || day === undefined) return undefined;
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return value;
  }
  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (match === null) return undefined;

  const [, day = '', abbreviation = '', year = ''] = match;
  const month = MONTHS.indexOf(abbreviation.toLowerCase());
  if (month < 0) return undefined;
  return `${year}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function isPositiveNumber(raw: string): boolean {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0;
}
