/**
 * app-services — use-case orchestration. The only layer `apps/*` may call.
 *
 * Composition, not computation: each use case wires pure engines to persistence
 * and returns. Any business rule appearing here belongs in a domain package.
 */
export {
  AuditUC,
  CompareSnapshotsUC,
  ComputeAdvanceTaxUC,
  GenerateComplianceUC,
  GenerateSnapshotUC,
  ImportStatementUC,
  LedgerUC,
  ListSnapshotsUC,
  LoanUC,
  ReferenceUC,
  TemplateUC,
  ValuePortfolioUC,
  VaultUC,
  setIncomeProfile,
  saveIncomeProfile,
  loadIncomeProfile,
  hasIncomeProfile,
  incomeProfileOf,
  recordLogLine,
  clearApplicationLog,
  type CalendarYearOption,
  type FinancialYearOption,
  type GenerateComplianceUCOps,
  type LoanQuery,
  type Periods,
  type RecordLoanInput,
  type RecordPaymentInput,
  type TemplateSummary,
} from './use-cases.js';

export {
  configure,
  currentPorts,
  resetPorts,
  type AppContext,
  type AssetSource,
  type LiabilitySource,
  type Ports,
} from './context.js';
