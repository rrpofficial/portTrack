/** Ingestion types. Types only — no runtime behaviour. */
import type { IsoDate, IsoDateTime, Money, Quantity } from '@porttrack/shared-kernel';

/**
 * `MANUAL` is not a file format — it is a trade typed into the app by hand.
 *
 * It is a ParserName so that a manual entry travels the SAME projection as an
 * imported one: identical FIFO, identical asset identity, identical disposal
 * handling. A parallel write path for manual trades would be a second engine to
 * keep in step with the first, and the two would drift.
 */
export type ParserName =
  | 'CAMS'
  | 'ZERODHA_TRADEBOOK'
  | 'ZERODHA_TAX_PNL'
  | 'VESTED'
  | 'ETRADE'
  | 'TEMPLATE'
  | 'MANUAL';
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

export interface ParsedLoanPayment {
  readonly date: IsoDate;
  readonly amount: Money;
}

/** Loan terms, present only on a hand-loan row. */
export interface ParsedHandLoan {
  /** Opaque; used for anything that leaves the machine (FR-7.2). */
  readonly borrowerRef: string;
  /** Kept for the register, which is filtered and sorted by it. Vault only. */
  readonly borrowerName: string;
  readonly interestRatePct: string;
  readonly interestBasis: 'SIMPLE' | 'COMPOUND';
  readonly startDate: IsoDate;
  readonly closedDate?: IsoDate;
  readonly notes?: string;
  readonly principalRepayments: readonly ParsedLoanPayment[];
  readonly interestPayments: readonly ParsedLoanPayment[];
  /**
   * The status the SOURCE claimed. Status is derived from repayments, so this is
   * used only to reconstruct a repayment the sheet had no column for: a loan
   * marked Repaid with no repayment rows must still show its principal back.
   */
  readonly declaredStatus?: 'ACTIVE' | 'PARTIALLY_REPAID' | 'REPAID';
}

/**
 * A figure the source stated that the engine computes differently.
 *
 * Neither value is discarded and neither silently wins: a spreadsheet cell can
 * be stale, but it can equally be catching a mistake here, and the only useful
 * thing to do with a disagreement about money is show it to the person who
 * knows which is right.
 */
export interface ReconciliationNote {
  readonly row: number;
  readonly field: string;
  readonly stated: string;
  readonly computed: string;
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
  /**
   * Set only when the SOURCE FORMAT states it — a portTrack template says which
   * asset class it holds; a broker CSV does not. Left absent rather than guessed,
   * because asset class drives tax treatment and a wrong guess is invisible.
   */
  readonly assetClass?: string;
  readonly fees?: Money;
  readonly otherCharges?: Money;
  readonly handLoan?: ParsedHandLoan;
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
  /**
   * Rows that parsed cleanly but could not be placed on the ledger — an
   * account-level fee with no lot to attach to, a sell with no matching holding.
   * Surfaced rather than dropped: a row the user believes was imported and that
   * silently vanished is the worst outcome an import can produce.
   */
  readonly unapplied?: readonly {
    readonly kind: ParsedTransaction['kind'];
    readonly date: IsoDate;
    readonly symbol?: string;
    readonly sourceRow: number;
    readonly reason: string;
  }[];
  /** Stated figures that the engine recomputed differently. Never silent. */
  readonly reconciliation?: readonly ReconciliationNote[];
}

export interface IngestInput {
  readonly file: Uint8Array;
  readonly fileName: string;
  readonly parser: ParserName;
  readonly mode: ImportMode;
  readonly password?: string;
  /**
   * Which portTrack template this is meant to be, when the user chose one.
   *
   * Optional: the template is still identified from its header, so an import
   * works without it. Supplying it turns a generic "matches no template" into a
   * diff naming the exact columns at fault, and catches a file uploaded under
   * the wrong template — which would otherwise import as the wrong asset class.
   */
  readonly templateName?: string;
  /** Natural keys already in the ledger, for duplicate detection (US-4.7). */
  readonly existingKeys?: readonly string[];
}

export type TransactionKind = ParsedTransaction['kind'];

export interface CamsParseInput {
  readonly pdf: Uint8Array;
  readonly password: string;
}
