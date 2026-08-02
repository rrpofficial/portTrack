/**
 * fx-itbr — SBI ITBR rate store, fallback chain, Rule 115 and dual-rate conversion.
 * Pure: fetching rate sheets is `adapters-fx`; this package only reasons about them.
 */
import type { Currency, IsoDate, Result } from '@porttrack/shared-kernel';
import { rateStore } from './rate-store.js';
import {
  convert,
  ratesFor,
  resolveRule115,
  resolveWithFallback,
  rule115BasisDate,
} from './resolvers.js';
import { parseSbiSheet, type SbiParseOptions } from './sbi-sheet.js';
import {
  amendmentLog,
  amendmentsForDate,
  clearAmendments,
  finaliseWithOfficialRate,
  isProvisional,
  registerSnapshotIndex,
  resetSnapshotIndex,
} from './amendment.js';
import type { RateRecord } from './types.js';

export * from './types.js';
export { InMemoryRateStore, rateStore } from './rate-store.js';
export { FALLBACK_ORDER, FALLBACK_FLAG } from './resolvers.js';

/** US-2.1 — rate storage with provenance. */
export const RateStore = {
  put: (record: RateRecord): Result<void> => rateStore.put(record),
  get: (currency: Currency, date: IsoDate, source: RateRecord['source']) =>
    rateStore.get(currency, date, source),
  latestOnOrBefore: (currency: Currency, date: IsoDate, source: RateRecord['source']) =>
    rateStore.latestOnOrBefore(currency, date, source),
  clear: () => { rateStore.clear(); },
};

/** US-2.3 — SBI → RBI → ECB → OANDA. */
export const FallbackChain = { resolve: resolveWithFallback };

/** US-2.4 — Rule 115 of the Income Tax Rules. */
export const Rule115Resolver = { basisDateFor: rule115BasisDate, resolve: resolveRule115 };

/** US-2.5 — the dual-rate service (ADR-003). */
export const DualRateConverter = { ratesFor, convert };

/** US-2.2 — SBI rate sheet ingestion. */
export const SbiSheetParser = {
  parse: (sheet: string, options?: SbiParseOptions): Result<readonly RateRecord[]> =>
    parseSbiSheet(sheet, options),
};

/** US-2.6 — retroactive finalisation of provisional rates. */
export const RateAmendment = {
  finaliseWithOfficialRate,
  isProvisional,
  log: amendmentLog,
  forDate: amendmentsForDate,
  clear: clearAmendments,
  registerSnapshotIndex,
  resetSnapshotIndex,
};
