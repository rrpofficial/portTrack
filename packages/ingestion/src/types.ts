/** Ingestion types. Types only — no runtime behaviour. */
import type { IsoDate, IsoDateTime, Money, Quantity } from '@porttrack/shared-kernel';

export type ParserName = 'CAMS' | 'ZERODHA_TRADEBOOK' | 'ZERODHA_TAX_PNL' | 'VESTED' | 'ETRADE' | 'TEMPLATE';
export type ImportMode = 'STRICT' | 'LENIENT';

export interface RowError {
  readonly row: number;
  readonly column: string;
  readonly value: string;
  readonly reason: string;
  readonly expectedFormat?: string;
}

export interface Provenance {
  readonly sourceFile: string;
  readonly sourceRow: number;
  readonly parserName: ParserName;
  readonly importedAt: IsoDateTime;
}

export interface ParsedTransaction {
  readonly kind: 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'RSU_VEST' | 'ESPP_PURCHASE' | 'REINVESTMENT';
  readonly date: IsoDate;
  readonly symbol?: string;
  readonly isin?: string;
  readonly folioRef?: string;
  readonly schemeName?: string;
  readonly quantity: Quantity;
  readonly pricePerUnit: Money;
  readonly perquisiteValue?: Money;
  readonly provenance: Provenance;
}

export interface ImportReport {
  readonly created: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly errors: readonly RowError[];
  readonly committed: boolean;
  /** Staged records, present only when the import committed. */
  readonly transactions?: readonly ParsedTransaction[];
}

export interface IngestInput {
  readonly file: Uint8Array;
  readonly fileName: string;
  readonly parser: ParserName;
  readonly mode: ImportMode;
  readonly password?: string;
  /** Natural keys already in the ledger, for duplicate detection (US-4.7). */
  readonly existingKeys?: readonly string[];
}

export type TransactionKind = ParsedTransaction['kind'];

export interface CamsParseInput {
  readonly pdf: Uint8Array;
  readonly password: string;
}
