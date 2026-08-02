/**
 * Indian Financial Year / Assessment Year calendar (US-5.1, PRD FR-5.1).
 *
 * FY runs 1 April → 31 March; AY is the following year. All end-of-day boundaries
 * resolve in Asia/Kolkata (ADR-008), and are produced by string construction rather
 * than `Date`, so results never depend on the host machine's timezone.
 */
import { InvalidDateError } from './errors.js';
import {
  IST_OFFSET,
  type FinancialYear,
  type FyCalendarOps,
  type IsoDate,
  type Percentage,
  type Quarter,
} from './types.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FY = /^(\d{4})-(\d{2})$/;

/** Cumulative advance-tax liability due by each quarter (PRD FR-5.3). */
const CUMULATIVE: Readonly<Record<Quarter, Percentage>> = {
  Q1: '15',
  Q2: '45',
  Q3: '75',
  Q4: '100',
};

/** Statutory due dates. Q1–Q3 fall in the FY's first calendar year, Q4 in the second. */
const DUE: Readonly<Record<Quarter, { month: string; day: string; inSecondYear: boolean }>> = {
  Q1: { month: '06', day: '15', inSecondYear: false },
  Q2: { month: '09', day: '15', inSecondYear: false },
  Q3: { month: '12', day: '15', inSecondYear: false },
  Q4: { month: '03', day: '15', inSecondYear: true },
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseDate(date: IsoDate): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new InvalidDateError(`expected YYYY-MM-DD, received "${date}"`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) throw new InvalidDateError(`month out of range in "${date}"`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new InvalidDateError(`day out of range in "${date}"`);
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

/** Returns the FY's opening calendar year: FY "2025-26" → 2025. */
function fyStartYear(fy: FinancialYear): number {
  const match = FY.exec(fy);
  if (!match) throw new InvalidDateError(`expected a financial year like "2025-26", received "${fy}"`);
  const startYear = Number(match[1]);
  const endShort = Number(match[2]);
  // "2025-26" is coherent; "2025-27" is not.
  if ((startYear + 1) % 100 !== endShort) {
    throw new InvalidDateError(`"${fy}" is not a contiguous financial year`);
  }
  return startYear;
}

export const FyCalendarImpl: FyCalendarOps = {
  financialYearOf: (date) => {
    const { year, month } = parseDate(date);
    // January–March belong to the FY that opened the previous April.
    const startYear = month >= 4 ? year : year - 1;
    return `${String(startYear)}-${pad2((startYear + 1) % 100)}`;
  },

  assessmentYearOf: (fy) => {
    const startYear = fyStartYear(fy) + 1;
    return `${String(startYear)}-${pad2((startYear + 1) % 100)}`;
  },

  fyStart: (fy) => `${String(fyStartYear(fy))}-04-01`,

  fyEnd: (fy) => `${String(fyStartYear(fy) + 1)}-03-31`,

  advanceTaxDueDate: (fy, quarter) => {
    // Guarded by key presence, not falsiness: `quarter` is typed as a closed union
    // but reaches this function from untyped sources such as API query strings.
    if (!Object.hasOwn(DUE, quarter)) {
      throw new InvalidDateError(`unknown advance tax quarter "${quarter}"`);
    }
    const due = DUE[quarter];
    return `${String(fyStartYear(fy) + (due.inSecondYear ? 1 : 0))}-${due.month}-${due.day}`;
  },

  cumulativePercentage: (quarter) => {
    if (!Object.hasOwn(CUMULATIVE, quarter)) {
      throw new InvalidDateError(`unknown advance tax quarter "${quarter}"`);
    }
    return CUMULATIVE[quarter];
  },

  endOfDayIst: (date) => {
    parseDate(date);
    return `${date}T23:59:59.999${IST_OFFSET}`;
  },
};
