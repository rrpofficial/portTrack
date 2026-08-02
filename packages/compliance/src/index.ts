/**
 * compliance — Schedule FA (Tables A3, D) and Schedule AL generation, ITR-ready export.
 * Foreign disclosures use the CALENDAR year; Schedule AL uses the 31-Mar snapshot.
 */
import {
  notImplemented,
  type IsoDate,
  type Money,
  type Result,
  type AssessmentYear,
} from '@porttrack/shared-kernel';
import type { Snapshot } from '@porttrack/snapshot';

export interface PeakValue {
  readonly peakNative: Money;
  readonly peakInr: Money;
  readonly peakDate: IsoDate;
}

export interface ScheduleFaA3Row {
  readonly countryCode: string;
  readonly entityName: string;
  readonly address: string;
  readonly natureOfEntity: string;
  readonly acquisitionDate: IsoDate;
  readonly initialInvestmentInr: Money;
  readonly peakValueInr: Money;
  readonly peakValueNative: Money;
  readonly closingValueInr: Money;
  readonly grossDividendInr: Money;
  readonly grossProceedsInr: Money;
}

export interface ScheduleFaDRow {
  readonly countryCode: string;
  readonly institutionName: string;
  /** Masked reference, never the raw account number. */
  readonly accountRef: string;
  readonly accountOpenDate: IsoDate;
  readonly peakBalanceInr: Money;
  readonly closingBalanceInr: Money;
}

export interface ScheduleAlSection {
  readonly head: string;
  readonly items: readonly { readonly description: string; readonly costOfAcquisition: Money }[];
  readonly total: Money;
}

export interface ScheduleAl {
  readonly assessmentYear: AssessmentYear;
  readonly required: boolean;
  readonly notRequiredReason?: string;
  readonly immovableProperty: ScheduleAlSection;
  readonly financialAssets: ScheduleAlSection;
  readonly cashInHand: ScheduleAlSection;
  readonly loansAndAdvancesGiven: ScheduleAlSection;
  readonly jewellery: ScheduleAlSection;
  readonly vehicles: ScheduleAlSection;
  readonly liabilities: ScheduleAlSection;
}

export interface PeakValueCalculatorOps {
  compute(input: {
    assetId: string;
    from: IsoDate;
    to: IsoDate;
    dailyQuantities: ReadonlyMap<IsoDate, string>;
    dailyPrices: ReadonlyMap<IsoDate, Money>;
    dailyRates: ReadonlyMap<IsoDate, string>;
  }): PeakValue;
}

export interface ScheduleFaGeneratorOps {
  tableA3(input: {
    foreignSnapshot: Snapshot;
    calendarYear: number;
  }): Result<readonly ScheduleFaA3Row[]>;
  tableD(input: {
    foreignSnapshot: Snapshot;
    calendarYear: number;
  }): Result<readonly ScheduleFaDRow[]>;
}

export interface ScheduleAlGeneratorOps {
  generate(input: {
    domesticSnapshot: Snapshot;
    totalIncome: Money;
    assessmentYear: AssessmentYear;
  }): Result<ScheduleAl>;
}

export interface ItrExporterOps {
  toJson(data: readonly ScheduleFaA3Row[] | ScheduleAl): string;
  toCsv(data: readonly ScheduleFaA3Row[] | ScheduleAl): string;
  validate(json: string, schemaName: string): Result<void>;
}

export const PeakValueCalculator: PeakValueCalculatorOps = {
  compute: () => notImplemented('US-6.1', 'PeakValueCalculator.compute'),
};
export const ScheduleFaGenerator: ScheduleFaGeneratorOps = {
  tableA3: () => notImplemented('US-6.2', 'ScheduleFaGenerator.tableA3'),
  tableD: () => notImplemented('US-6.3', 'ScheduleFaGenerator.tableD'),
};
export const ScheduleAlGenerator: ScheduleAlGeneratorOps = {
  generate: () => notImplemented('US-6.4', 'ScheduleAlGenerator.generate'),
};
export const ItrExporter: ItrExporterOps = {
  toJson: () => notImplemented('US-6.5', 'ItrExporter.toJson'),
  toCsv: () => notImplemented('US-6.5', 'ItrExporter.toCsv'),
  validate: () => notImplemented('US-6.5', 'ItrExporter.validate'),
};
