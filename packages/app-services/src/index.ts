/**
 * app-services — use-case orchestration. The only layer `apps/api` may call.
 * Functional acceptance tests drive the system through this surface, not through internals.
 */
import {
  notImplemented,
  type FinancialYear,
  type IsoDate,
  type IsoDateTime,
  type Money,
  type Quantity,
  type Quarter,
  type Result,
  type EgressAuditEntry,
} from '@porttrack/shared-kernel';
import type { ExitTransaction, PortfolioValuation } from '@porttrack/core-domain';
import type { Snapshot, SnapshotSpec, VarianceReport } from '@porttrack/snapshot';
import type { AdvanceTaxInstallment, HniClassification, RegimeComparison } from '@porttrack/tax-engine';
import type { ImportMode, ImportReport, ParserName } from '@porttrack/ingestion';
import type { ScheduleAl, ScheduleFaA3Row, ScheduleFaDRow } from '@porttrack/compliance';

export interface AppContext {
  readonly dataDir: string;
  readonly unlocked: boolean;
}

export interface RecordExitCommand {
  readonly assetId: string;
  readonly exitDate: IsoDate;
  readonly quantity: Quantity;
  readonly pricePerUnit: Money;
  readonly fees?: Money;
  readonly stt?: Money;
}

export interface RecordTransactionUCOps {
  recordExit(cmd: RecordExitCommand): Promise<Result<ExitTransaction>>;
}

export interface ValuePortfolioUCOps {
  execute(asOf: IsoDateTime): Promise<Result<PortfolioValuation>>;
}

export interface GenerateSnapshotUCOps {
  generate(spec: SnapshotSpec): Promise<Result<Snapshot>>;
  runScheduler(now: IsoDateTime): Promise<Result<readonly string[]>>;
  custom(asOf: IsoDate): Promise<Result<Snapshot>>;
}

export interface CompareSnapshotsUCOps {
  snapshotToSnapshot(beforeId: string, afterId: string): Promise<Result<VarianceReport>>;
  snapshotToLive(beforeId: string, now: IsoDateTime): Promise<Result<VarianceReport>>;
}

export interface ComputeAdvanceTaxUCOps {
  execute(input: {
    financialYear: FinancialYear;
    quarter: Quarter;
  }): Promise<Result<AdvanceTaxInstallment>>;
  compareRegimes(financialYear: FinancialYear): Promise<Result<RegimeComparison>>;
  hniStatus(financialYear: FinancialYear): Promise<Result<HniClassification>>;
}

export interface ImportStatementUCOps {
  execute(input: {
    file: Uint8Array;
    fileName: string;
    parser: ParserName;
    mode: ImportMode;
    password?: string;
  }): Promise<Result<ImportReport>>;
}

export interface GenerateComplianceUCOps {
  scheduleFaA3(calendarYear: number): Promise<Result<readonly ScheduleFaA3Row[]>>;
  scheduleFaD(calendarYear: number): Promise<Result<readonly ScheduleFaDRow[]>>;
  scheduleAl(financialYear: FinancialYear): Promise<Result<ScheduleAl>>;
}

export interface VaultUCOps {
  unlock(passphrase: string): Promise<Result<AppContext>>;
  lock(): Promise<void>;
}

export interface AuditUCOps {
  egressLog(): Promise<readonly EgressAuditEntry[]>;
  applicationLog(): Promise<readonly string[]>;
}

export const RecordTransactionUC: RecordTransactionUCOps = {
  recordExit: () => notImplemented('US-1.3', 'RecordTransactionUC.recordExit'),
};
export const ValuePortfolioUC: ValuePortfolioUCOps = {
  execute: () => notImplemented('US-1.15', 'ValuePortfolioUC.execute'),
};
export const GenerateSnapshotUC: GenerateSnapshotUCOps = {
  generate: () => notImplemented('US-3.1', 'GenerateSnapshotUC.generate'),
  runScheduler: () => notImplemented('US-3.2', 'GenerateSnapshotUC.runScheduler'),
  custom: () => notImplemented('US-3.4', 'GenerateSnapshotUC.custom'),
};
export const CompareSnapshotsUC: CompareSnapshotsUCOps = {
  snapshotToSnapshot: () => notImplemented('US-3.5', 'CompareSnapshotsUC.snapshotToSnapshot'),
  snapshotToLive: () => notImplemented('US-3.6', 'CompareSnapshotsUC.snapshotToLive'),
};
export const ComputeAdvanceTaxUC: ComputeAdvanceTaxUCOps = {
  execute: () => notImplemented('US-5.10', 'ComputeAdvanceTaxUC.execute'),
  compareRegimes: () => notImplemented('US-5.4', 'ComputeAdvanceTaxUC.compareRegimes'),
  hniStatus: () => notImplemented('US-5.6', 'ComputeAdvanceTaxUC.hniStatus'),
};
export const ImportStatementUC: ImportStatementUCOps = {
  execute: () => notImplemented('US-4.1', 'ImportStatementUC.execute'),
};
export const GenerateComplianceUC: GenerateComplianceUCOps = {
  scheduleFaA3: () => notImplemented('US-6.2', 'GenerateComplianceUC.scheduleFaA3'),
  scheduleFaD: () => notImplemented('US-6.3', 'GenerateComplianceUC.scheduleFaD'),
  scheduleAl: () => notImplemented('US-6.4', 'GenerateComplianceUC.scheduleAl'),
};
export const VaultUC: VaultUCOps = {
  unlock: () => notImplemented('US-8.2', 'VaultUC.unlock'),
  lock: () => notImplemented('US-8.2', 'VaultUC.lock'),
};
export const AuditUC: AuditUCOps = {
  egressLog: () => notImplemented('US-8.10', 'AuditUC.egressLog'),
  applicationLog: () => notImplemented('US-8.9', 'AuditUC.applicationLog'),
};
