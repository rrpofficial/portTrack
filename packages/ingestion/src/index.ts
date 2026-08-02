/**
 * ingestion — parse → validate → stage → reconcile → commit, and the per-broker parsers.
 */
import {
  notImplemented,
  type IsoDate,
  type IsoDateTime,
  type Money,
  type Quantity,
  type Result,
} from '@porttrack/shared-kernel';

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
}

export interface CamsParseInput {
  readonly pdf: Uint8Array;
  readonly password: string;
}

export interface PipelineOps {
  ingest(input: {
    file: Uint8Array;
    fileName: string;
    parser: ParserName;
    mode: ImportMode;
    password?: string;
  }): Promise<Result<ImportReport>>;
}

export interface CamsCasParserOps {
  parse(input: CamsParseInput): Promise<Result<readonly ParsedTransaction[]>>;
}

export interface CsvParserOps {
  parse(csv: string, fileName: string): Result<readonly ParsedTransaction[]>;
}

export interface XlsxParserOps {
  parse(buffer: Uint8Array, fileName: string): Result<readonly ParsedTransaction[]>;
}

export interface ReconciliationExceptionsOps {
  /** Compares broker-stated realised gains against ours; variance > ₹1 is an exception. */
  compareRealisedGains(input: {
    brokerStated: Money;
    computed: Money;
  }): { readonly variance: Money; readonly isException: boolean };
}

export interface TemplateRegistryOps {
  list(): readonly string[];
  generate(templateName: string): string;
  validateHeaders(csv: string, templateName: string): Result<void>;
}

export interface DuplicateDetectorOps {
  naturalKey(txn: ParsedTransaction): string;
  partition(
    incoming: readonly ParsedTransaction[],
    existingKeys: readonly string[],
  ): { readonly fresh: readonly ParsedTransaction[]; readonly duplicates: readonly ParsedTransaction[] };
}

export const Pipeline: PipelineOps = {
  ingest: () => notImplemented('US-4.1', 'Pipeline.ingest'),
};
export const CamsCasParser: CamsCasParserOps = {
  parse: () => notImplemented('US-4.2', 'CamsCasParser.parse'),
};
export const ZerodhaTradebookParser: CsvParserOps = {
  parse: () => notImplemented('US-4.3', 'ZerodhaTradebookParser.parse'),
};
export const ZerodhaTaxPnlParser: XlsxParserOps = {
  parse: () => notImplemented('US-4.3', 'ZerodhaTaxPnlParser.parse'),
};
export const VestedParser: CsvParserOps = {
  parse: () => notImplemented('US-4.4', 'VestedParser.parse'),
};
export const EtradeParser: CsvParserOps = {
  parse: () => notImplemented('US-4.5', 'EtradeParser.parse'),
};
export const TemplateParser: CsvParserOps = {
  parse: () => notImplemented('US-4.6', 'TemplateParser.parse'),
};
export const TemplateRegistry: TemplateRegistryOps = {
  list: () => notImplemented('US-4.6', 'TemplateRegistry.list'),
  generate: () => notImplemented('US-4.6', 'TemplateRegistry.generate'),
  validateHeaders: () => notImplemented('US-4.6', 'TemplateRegistry.validateHeaders'),
};
export const DuplicateDetector: DuplicateDetectorOps = {
  naturalKey: () => notImplemented('US-4.7', 'DuplicateDetector.naturalKey'),
  partition: () => notImplemented('US-4.7', 'DuplicateDetector.partition'),
};
export const ReconciliationExceptions: ReconciliationExceptionsOps = {
  compareRealisedGains: () =>
    notImplemented('US-4.3', 'ReconciliationExceptions.compareRealisedGains'),
};
