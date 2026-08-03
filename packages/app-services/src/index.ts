/**
 * app-services — use-case orchestration. The only layer `apps/*` may call.
 *
 * Composition, not computation: each use case wires pure engines to persistence
 * and returns. Any business rule appearing here belongs in a domain package.
 */
import { notImplemented, type FinancialYear, type Result } from '@porttrack/shared-kernel';
import type { ScheduleAl, ScheduleFaA3Row, ScheduleFaDRow } from '@porttrack/compliance';

export {
  AuditUC,
  CompareSnapshotsUC,
  ComputeAdvanceTaxUC,
  GenerateSnapshotUC,
  ImportStatementUC,
  ValuePortfolioUC,
  VaultUC,
  setIncomeProfile,
  hasIncomeProfile,
  recordLogLine,
  clearApplicationLog,
} from './use-cases.js';

export { configure, currentPorts, resetPorts, type AppContext, type Ports } from './context.js';

/* ----------------------------------------------- Phase 2 (M10, EPIC-6) */

export interface GenerateComplianceUCOps {
  scheduleFaA3(calendarYear: number): Promise<Result<readonly ScheduleFaA3Row[]>>;
  scheduleFaD(calendarYear: number): Promise<Result<readonly ScheduleFaDRow[]>>;
  scheduleAl(financialYear: FinancialYear): Promise<Result<ScheduleAl>>;
}

export const GenerateComplianceUC: GenerateComplianceUCOps = {
  scheduleFaA3: () => notImplemented('US-6.2', 'GenerateComplianceUC.scheduleFaA3'),
  scheduleFaD: () => notImplemented('US-6.3', 'GenerateComplianceUC.scheduleFaD'),
  scheduleAl: () => notImplemented('US-6.4', 'GenerateComplianceUC.scheduleAl'),
};
