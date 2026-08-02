/**
 * fx-itbr — SBI ITBR rate store, fallback chain, Rule 115 and dual-rate conversion.
 * Pure: fetching rate sheets is `adapters-fx`; this package only reasons about them.
 */
import { notImplemented, type Currency, type IsoDate, type Result } from '@porttrack/shared-kernel';
import type { DualRate } from '@porttrack/core-domain';
import { rateStore } from './rate-store.js';
import {
  convert,
  ratesFor,
  resolveRule115,
  resolveWithFallback,
  rule115BasisDate,
} from './resolvers.js';
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

/* --------------------------------------------------- not yet implemented */

export interface SbiSheetParserOps {
  parse(sheet: string): Result<readonly RateRecord[]>;
}
export interface RateAmendmentOps {
  finaliseWithOfficialRate(input: { txnId: string; official: RateRecord }): Result<{
    readonly amendmentId: string;
    readonly previous: DualRate;
    readonly current: DualRate;
    readonly affectedSnapshots: readonly string[];
  }>;
}

export const SbiSheetParser: SbiSheetParserOps = {
  parse: () => notImplemented('US-2.2', 'SbiSheetParser.parse'),
};
export const RateAmendment: RateAmendmentOps = {
  finaliseWithOfficialRate: () => notImplemented('US-2.6', 'RateAmendment.finaliseWithOfficialRate'),
};
