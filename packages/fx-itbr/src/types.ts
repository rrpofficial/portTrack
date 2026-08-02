/** FX rate types. Types only — no runtime behaviour. */
import type { Currency, IsoDate, IsoDateTime, Rate } from '@porttrack/shared-kernel';
import type { RateSource } from '@porttrack/core-domain';

export type RateType = 'TTBR' | 'TTSR' | 'REFERENCE';

export interface RateRecord {
  readonly currency: Currency;
  readonly date: IsoDate;
  readonly rate: Rate;
  readonly source: RateSource;
  readonly rateType: RateType;
  readonly retrievedAt: IsoDateTime;
  readonly sourceDocumentRef: string;
}

export interface ResolvedRate {
  readonly rate: Rate;
  readonly source: RateSource;
  readonly appliedDate: IsoDate;
  readonly isFallback: boolean;
  readonly flag?: string;
  /** Ordered list of sources tried, for audit. */
  readonly resolutionPath: readonly string[];
}
