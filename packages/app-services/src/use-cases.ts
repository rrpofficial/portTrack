/**
 * Use-case orchestration (US-8.11 and the functional half of EPIC-3/5).
 *
 * Every use case is a thin composition of pure engines plus persistence. No
 * business rule lives here — if a calculation appears in this file it is in the
 * wrong layer, and the API's "thin shell" test exists to keep it that way.
 */
import {
  Err,
  FutureSnapshotError,
  Ok,
  VaultStateError,
  type EgressAuditEntry,
  type FinancialYear,
  type IsoDate,
  type IsoDateTime,
  type Quarter,
  type Result,
} from '@porttrack/shared-kernel';
import { ValuationEngine, type PortfolioValuation } from '@porttrack/core-domain';
import {
  CompliancePolicy,
  DeltaEngine,
  SnapshotFactory,
  type Snapshot,
  type SnapshotSpec,
  type VarianceReport,
} from '@porttrack/snapshot';
import {
  AdvanceTaxEngine,
  HniClassifier,
  SlabCalculator,
  TaxRuleTable,
  type AdvanceTaxInstallment,
  type HniClassification,
  type IncomeProfile,
  type RegimeComparison,
} from '@porttrack/tax-engine';
import { Pipeline, type ImportMode, type ImportReport, type ParserName } from '@porttrack/ingestion';
import { SnapshotRepository, Vault } from '@porttrack/persistence';
import { currentPorts } from './context.js';

/* ------------------------------------------------------------------- vault */

export const VaultUC = {
  async unlock(passphrase: string) {
    const result = await Vault.unlock(passphrase);
    if (!result.ok) return result;
    currentPorts().logger.info('vault unlocked');
    return Ok({ dataDir: '', unlocked: true });
  },
  async lock(): Promise<void> {
    await Vault.lock();
  },
  /** Exposed so the API can answer readiness without importing persistence. */
  isUnlocked(): boolean {
    return Vault.isUnlocked();
  },
};

const requireUnlocked = (): Result<void> =>
  Vault.isUnlocked() ? Ok(undefined) : Err(new VaultStateError('vault is locked'));

/* --------------------------------------------------------------- valuation */

export const ValuePortfolioUC = {
  execute(asOf: IsoDateTime): Promise<Result<PortfolioValuation>> {
    const guard = requireUnlocked();
    if (!guard.ok) return Promise.resolve(guard);

    const ports = currentPorts();
    return Promise.resolve(
      Ok(
        ValuationEngine.value({
          assets: ports.assets(),
          liabilities: ports.liabilities(),
          asOf,
          ...(ports.prices === undefined ? {} : { prices: ports.prices }),
          ...(ports.fx === undefined ? {} : { fx: ports.fx }),
        }),
      ),
    );
  },
};

/* ---------------------------------------------------------------- snapshots */

async function buildSnapshot(spec: SnapshotSpec, createdAt?: IsoDateTime): Promise<Result<Snapshot>> {
  const valuation = await ValuePortfolioUC.execute(spec.asOf);
  if (!valuation.ok) return valuation;

  const built = SnapshotFactory.build({
    spec,
    valuation: valuation.value,
    // A scheduled snapshot is created at the instant the scheduler ran, not at
    // whatever the ambient clock says: the two differ whenever a run is replayed
    // or caught up, and using the clock would reject a legitimate catch-up as
    // "future-dated".
    createdAt: createdAt ?? currentPorts().clock.now(),
  });
  if (!built.ok) return built;

  const persisted = await SnapshotRepository.persistImmutable(built.value);
  return persisted.ok ? Ok(built.value) : persisted;
}

export const GenerateSnapshotUC = {
  async generate(spec: SnapshotSpec): Promise<Result<Snapshot>> {
    // Idempotent: an existing snapshot is returned, never rebuilt (ADR-006).
    const existing = await SnapshotRepository.findById(spec.snapshotId);
    if (existing !== undefined) return Ok(existing);
    return buildSnapshot(spec);
  },

  async runScheduler(now: IsoDateTime, since?: IsoDateTime): Promise<Result<readonly string[]>> {
    const existing = await SnapshotRepository.listIds();
    // `since` is the last successful run, so a user who has not opened the app
    // for months still gets their statutory snapshots (see CompliancePolicy).
    const due = CompliancePolicy.dueSnapshots(now, existing, since === undefined ? {} : { since });

    const created: string[] = [];
    for (const spec of due) {
      const result = await buildSnapshot(spec, now);
      if (!result.ok) return result;
      created.push(result.value.snapshotId);
    }
    return Ok(created);
  },

  async custom(asOf: IsoDate): Promise<Result<Snapshot>> {
    const today = currentPorts().clock.today();
    const guard = SnapshotFactory.assertNotFuture(asOf, today);
    if (!guard.ok) return Err(new FutureSnapshotError(guard.error.message));

    return buildSnapshot({
      snapshotId: `CUSTOM_${asOf}`,
      kind: 'CUSTOM',
      scope: 'ALL',
      asOf: `${asOf}T23:59:59.999+05:30`,
    });
  },
};

export const CompareSnapshotsUC = {
  async snapshotToSnapshot(beforeId: string, afterId: string): Promise<Result<VarianceReport>> {
    const before = await SnapshotRepository.findById(beforeId);
    const after = await SnapshotRepository.findById(afterId);
    if (before === undefined || after === undefined) {
      return Err(new VaultStateError('one or both snapshots were not found'));
    }
    return Ok(DeltaEngine.compare(before, after));
  },

  async snapshotToLive(beforeId: string, now: IsoDateTime): Promise<Result<VarianceReport>> {
    const before = await SnapshotRepository.findById(beforeId);
    if (before === undefined) {
      return Err(new VaultStateError(`snapshot ${beforeId} was not found`));
    }
    const live = await ValuePortfolioUC.execute(now);
    if (!live.ok) return live;
    return Ok(DeltaEngine.compare(before, live.value));
  },
};

/* --------------------------------------------------------------------- tax */

/** Income profile for the year. Supplied by Form 16 import or manual entry. */
let incomeProfile: IncomeProfile | undefined;
export function setIncomeProfile(profile: IncomeProfile | undefined): void {
  incomeProfile = profile;
}

export function hasIncomeProfile(): boolean {
  return incomeProfile !== undefined;
}

/**
 * No recorded income means zero income, not a failure — advance tax on nothing is
 * legitimately nil. Callers MUST surface `hasIncomeProfile()` alongside the
 * figure, though: a user who simply forgot to import their Form 16 would
 * otherwise read "₹0 due" as an answer rather than as a missing input.
 */
function profileFor(fy: FinancialYear): Result<IncomeProfile> {
  if (incomeProfile !== undefined) return Ok(incomeProfile);

  const zero = { amount: '0', currency: 'INR' as const };
  return Ok({
    financialYear: fy,
    assessmentYear: fy,
    grossSalary: zero,
    exemptAllowances: zero,
    chapterViaDeductions: zero,
    housePropertyIncome: zero,
    otherSourcesIncome: zero,
    tdsRemitted: zero,
    tcsCollected: zero,
  });
}

export const ComputeAdvanceTaxUC = {
  execute(input: {
    financialYear: FinancialYear;
    quarter: Quarter;
  }): Promise<Result<AdvanceTaxInstallment>> {
    // Rules resolve first: a missing rule set must surface as its own error
    // rather than as a missing income profile (ADR-005).
    const rules = TaxRuleTable.rulesFor(input.financialYear);
    if (!rules.ok) return Promise.resolve(rules);

    const profile = profileFor(input.financialYear);
    if (!profile.ok) return Promise.resolve(profile);

    return Promise.resolve(
      AdvanceTaxEngine.installment({
        financialYear: input.financialYear,
        quarter: input.quarter,
        income: profile.value,
        exits: [],
        assetClasses: {},
        alreadyPaid: { amount: '0', currency: 'INR' },
        rules: rules.value,
      }),
    );
  },

  compareRegimes(financialYear: FinancialYear): Promise<Result<RegimeComparison>> {
    const rules = TaxRuleTable.rulesFor(financialYear);
    if (!rules.ok) return Promise.resolve(rules);
    const profile = profileFor(financialYear);
    if (!profile.ok) return Promise.resolve(profile);
    return Promise.resolve(Ok(SlabCalculator.compare(profile.value, rules.value)));
  },

  async hniStatus(financialYear: FinancialYear): Promise<Result<HniClassification>> {
    const rules = TaxRuleTable.rulesFor(financialYear);
    if (!rules.ok) return rules;
    const profile = profileFor(financialYear);
    if (!profile.ok) return profile;

    const valuation = await ValuePortfolioUC.execute(currentPorts().clock.now());
    const netWorth = valuation.ok ? valuation.value.netWorth : { amount: '0', currency: 'INR' as const };

    return Ok(
      HniClassifier.classify({
        totalIncome: profile.value.grossSalary,
        netWorth,
        rules: rules.value,
      }),
    );
  },
};

/* --------------------------------------------------------------- ingestion */

export const ImportStatementUC = {
  execute(input: {
    file: Uint8Array;
    fileName: string;
    parser: ParserName;
    mode: ImportMode;
    password?: string;
  }): Promise<Result<ImportReport>> {
    return Pipeline.ingest(input);
  },
};

/* ------------------------------------------------------------------- audit */

export const AuditUC = {
  egressLog(): Promise<readonly EgressAuditEntry[]> {
    // Nothing is dispatched without the egress profile, so an empty log is the
    // correct answer for a default install (ADR-010).
    return Promise.resolve([]);
  },
  applicationLog(): Promise<readonly string[]> {
    return Promise.resolve(applicationLogLines);
  },
};

const applicationLogLines: string[] = [];
export function recordLogLine(line: string): void {
  applicationLogLines.push(line);
}
export function clearApplicationLog(): void {
  applicationLogLines.length = 0;
}
