/**
 * FX rate store with provenance (US-2.1, PRD FR-2.1).
 *
 * Rates are write-once per (currency, date, source). A silent overwrite would let a
 * corrected rate sheet retroactively change a frozen snapshot's value with no trace,
 * so a differing value for an existing key is an error, not an update — corrections
 * go through the amendment path (US-2.6) instead.
 */
import { Err, Ok, RateConflictError, type Currency, type IsoDate, type Result } from '@porttrack/shared-kernel';
import type { RateSource } from '@porttrack/core-domain';
import type { RateRecord } from './types.js';

const keyOf = (currency: Currency, date: IsoDate, source: RateSource) =>
  `${currency}|${date}|${source}`;

export class InMemoryRateStore {
  private readonly records = new Map<string, RateRecord>();

  put(record: RateRecord): Result<void> {
    const key = keyOf(record.currency, record.date, record.source);
    const existing = this.records.get(key);
    if (existing !== undefined) {
      if (existing.rate === record.rate) return Ok(undefined); // idempotent
      return Err(
        new RateConflictError(
          `conflicting ${record.currency} rate for ${record.date} from ${record.source}: ` +
            `stored ${existing.rate}, received ${record.rate}`,
        ),
      );
    }
    this.records.set(key, record);
    return Ok(undefined);
  }

  get(currency: Currency, date: IsoDate, source: RateSource): RateRecord | undefined {
    return this.records.get(keyOf(currency, date, source));
  }

  /** Most recent record on or before `date`, walking back over non-publishing days. */
  latestOnOrBefore(
    currency: Currency,
    date: IsoDate,
    source: RateSource,
  ): RateRecord | undefined {
    let best: RateRecord | undefined;
    for (const record of this.records.values()) {
      if (record.currency !== currency || record.source !== source) continue;
      if (record.date > date) continue;
      if (best === undefined || record.date > best.date) best = record;
    }
    return best;
  }

  clear(): void {
    this.records.clear();
  }

  size(): number {
    return this.records.size;
  }
}

/** Process-wide store. Single-tenant, single-process by design (ADR-011). */
export const rateStore = new InMemoryRateStore();
