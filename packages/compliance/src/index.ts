/**
 * compliance — Schedule FA (Tables A3, D) and Schedule AL generation, plus
 * ITR-ready export. Pure.
 *
 * Two distinctions carry the whole package: Schedule FA runs on the CALENDAR
 * year while everything else is FY-aligned, and Schedule AL reports COST of
 * acquisition while the rest of the product reports market value.
 */
import { compute, computeFromAcquisition } from './peak-value.js';
import { accountRef, calendarYearWindow, tableA3, tableD } from './schedule-fa.js';
import { generate } from './schedule-al.js';
import { toCsv, toJson, validate } from './itr-export.js';

export * from './types.js';
export type { PeakValueInput } from './peak-value.js';
export { WrongSnapshotScopeError } from './schedule-fa.js';
export { SchemaValidationError, A3_COLUMNS, D_COLUMNS } from './itr-export.js';

/** US-6.1 — highest value reached during the disclosure period. */
export const PeakValueCalculator = { compute, computeFromAcquisition };

/** US-6.2 / US-6.3 — foreign asset disclosure. */
export const ScheduleFaGenerator = { tableA3, tableD, calendarYearWindow, accountRef };

/** US-6.4 — assets and liabilities at year end. */
export const ScheduleAlGenerator = { generate };

/** US-6.5 — ITR-ready JSON and CSV. */
export const ItrExporter = { toJson, toCsv, validate };
