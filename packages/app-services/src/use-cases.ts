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
  FyCalendar,
  Ok,
  VaultStateError,
  type EgressAuditEntry,
  type FinancialYear,
  type IsoDate,
  type IsoDateTime,
  type Quarter,
  type Result,
} from '@porttrack/shared-kernel';
import {
  ValuationEngine,
  type Asset,
  type ExitTransaction,
  type Liability,
  type PortfolioValuation,
} from '@porttrack/core-domain';
import {
  ScheduleAlGenerator,
  ScheduleFaGenerator,
  type ScheduleAl,
  type ScheduleFaA3Row,
  type ScheduleFaDRow,
} from '@porttrack/compliance';
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
import {
  LedgerProjector,
  ledgerNaturalKeys,
  Pipeline,
  TemplateRegistry,
  type ImportMode,
  type ImportReport,
  type ParserName,
} from '@porttrack/ingestion';
import {
  AssetRepository,
  ExitRepository,
  LiabilityRepository,
  SettingsRepository,
  SnapshotRepository,
  Vault,
  type SnapshotSummary,
} from '@porttrack/persistence';
import { currentPorts } from './context.js';

/* ------------------------------------------------------------------- vault */

export const VaultUC = {
  async unlock(passphrase: string) {
    const result = await Vault.unlock(passphrase);
    if (!result.ok) return result;
    // Vault-backed state can only be read once the key exists.
    await loadIncomeProfile();
    currentPorts().logger.info('vault unlocked');
    return Ok({ dataDir: '', unlocked: true });
  },
  async lock(): Promise<void> {
    await Vault.lock();
    // Salary is as sensitive as holdings; it must not outlive the session in
    // memory once the vault it came from is closed.
    setIncomeProfile(undefined);
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
  async execute(asOf: IsoDateTime): Promise<Result<PortfolioValuation>> {
    const guard = requireUnlocked();
    if (!guard.ok) return guard;

    const ports = currentPorts();
    // Awaited because the production source is the vault; a test fixture that
    // returns a plain array still satisfies this.
    const [assets, liabilities] = await Promise.all([ports.assets(), ports.liabilities()]);

    return Ok(
      ValuationEngine.value({
        assets,
        liabilities,
        asOf,
        ...(ports.prices === undefined ? {} : { prices: ports.prices }),
        ...(ports.fx === undefined ? {} : { fx: ports.fx }),
      }),
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

export const ListSnapshotsUC = {
  execute(): Promise<readonly SnapshotSummary[]> {
    return SnapshotRepository.list();
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

/**
 * Income profile for the year. Supplied by Form 16 import or manual entry.
 *
 * Cached in memory and written through to the vault: it is read on every tax
 * computation, and holding it only in memory meant a container restart silently
 * reverted the figure to "zero income" — which reads as an answer, not as a
 * missing input.
 */
const INCOME_PROFILE_KEY = 'tax.incomeProfile';
let incomeProfile: IncomeProfile | undefined;

export function setIncomeProfile(profile: IncomeProfile | undefined): void {
  incomeProfile = profile;
}

/** Persists as well as sets. Async because it writes. */
export async function saveIncomeProfile(
  profile: IncomeProfile | undefined,
): Promise<Result<void>> {
  incomeProfile = profile;
  return profile === undefined
    ? SettingsRepository.delete(INCOME_PROFILE_KEY)
    : SettingsRepository.set(
        INCOME_PROFILE_KEY,
        JSON.stringify(profile),
        currentPorts().clock.now(),
      );
}

/** Rehydrates the cache from the vault. Called once the vault is unlocked. */
export async function loadIncomeProfile(): Promise<void> {
  const stored = await SettingsRepository.get(INCOME_PROFILE_KEY);
  incomeProfile = stored === undefined ? undefined : (JSON.parse(stored) as IncomeProfile);
}

export function hasIncomeProfile(): boolean {
  return incomeProfile !== undefined;
}

export function incomeProfileOf(): IncomeProfile | undefined {
  return incomeProfile;
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
    // AY is the year AFTER the FY: income earned in FY 2025-26 is assessed in
    // AY 2026-27. This previously repeated the FY, which labels every return
    // with the wrong year — a filing-level error, not a display one.
    assessmentYear: FyCalendar.assessmentYearOf(fy),
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
  /**
   * Parses AND commits. Returning a report without writing anything was the
   * original shape, and it made an import look successful while the portfolio
   * stayed empty — the failure mode is invisible precisely because the report
   * says "created: 65".
   */
  async execute(input: {
    file: Uint8Array;
    fileName: string;
    parser: ParserName;
    mode: ImportMode;
    password?: string;
  }): Promise<Result<ImportReport>> {
    const guard = requireUnlocked();
    if (!guard.ok) return guard;

    const [existing, existingExits] = await Promise.all([
      AssetRepository.all(),
      ExitRepository.all(),
    ]);
    // Rebuilt from the holdings themselves, so re-importing an overlapping export
    // recognises trades already on the ledger (US-4.7).
    const existingKeys = ledgerNaturalKeys(existing, existingExits);

    const report = await Pipeline.ingest({ ...input, existingKeys });
    if (!report.ok) return report;
    if (!report.value.committed) return report;

    const projected = LedgerProjector.project({
      transactions: report.value.transactions ?? [],
      parser: input.parser,
      existing,
      existingExits,
    });
    if (!projected.ok) return projected;

    const saved = await AssetRepository.saveAll(projected.value.assets);
    if (!saved.ok) return saved;

    // After the assets: an exit references its asset by foreign key.
    const savedExits = await ExitRepository.saveAll(projected.value.exits);
    if (!savedExits.ok) return savedExits;

    return Ok({
      ...report.value,
      // Rows the projection could not place are reported, never dropped.
      unapplied: projected.value.unapplied,
    });
  },
};

/* ----------------------------------------------------------- reference data */

export interface FinancialYearOption {
  readonly financialYear: FinancialYear;
  readonly assessmentYear: string;
  readonly isCurrent: boolean;
  /** False when no rule set exists; the engine refuses rather than approximating. */
  readonly rulesAvailable: boolean;
  readonly rulesStatus?: 'PROVISIONAL' | 'VERIFIED';
}

export interface CalendarYearOption {
  readonly calendarYear: number;
  readonly isCurrent: boolean;
  /** A calendar year still running cannot have a closing 31-December position. */
  readonly isComplete: boolean;
}

export interface Periods {
  readonly today: IsoDate;
  readonly currentFinancialYear: FinancialYear;
  readonly currentAssessmentYear: string;
  readonly currentCalendarYear: number;
  /**
   * What a picker should START on, which is not always the current year.
   *
   * Offering a period and defaulting to it are different decisions. The current
   * FY is always OFFERED — a user looking for the year they are in must find it.
   * But rates for a year are published during it at the earliest, so defaulting
   * to a year with no rule set would make the tax screen look broken on first
   * open, for a reason that has nothing to do with the user.
   */
  readonly defaultFinancialYear: FinancialYear;
  /** Schedule FA reports a 31-December position, so a running year has none. */
  readonly defaultCalendarYear: number;
  readonly financialYears: readonly FinancialYearOption[];
  readonly calendarYears: readonly CalendarYearOption[];
}

const YEARS_OFFERED = 5;

/**
 * The periods the UI offers, derived on the SERVER.
 *
 * Deliberately not computed in the browser. A client west of UTC would decide it
 * is still 31 March while the server has moved into the next financial year, and
 * the dropdown would then disagree with the engine that computes the tax. One
 * clock, injected, is the only way those two can never diverge (ADR-008).
 */
export const ReferenceUC = {
  periods(): Periods {
    const today = currentPorts().clock.today();
    const currentFy = FyCalendar.financialYearOf(today);
    const currentCy = Number(today.slice(0, 4));
    const startYear = Number(currentFy.slice(0, 4));

    const financialYears: FinancialYearOption[] = [];
    // Current year first, then backwards: the year a user is filing for is
    // almost always the current or the immediately preceding one.
    for (let offset = 0; offset < YEARS_OFFERED; offset++) {
      const year = startYear - offset;
      const fy = `${String(year)}-${String((year + 1) % 100).padStart(2, '0')}`;
      const rules = TaxRuleTable.rulesFor(fy);
      financialYears.push({
        financialYear: fy,
        assessmentYear: FyCalendar.assessmentYearOf(fy),
        isCurrent: fy === currentFy,
        rulesAvailable: rules.ok,
        ...(rules.ok ? { rulesStatus: rules.value.status } : {}),
      });
    }

    const calendarYears: CalendarYearOption[] = [];
    for (let offset = 0; offset < YEARS_OFFERED; offset++) {
      const year = currentCy - offset;
      calendarYears.push({
        calendarYear: year,
        isCurrent: year === currentCy,
        isComplete: year < currentCy,
      });
    }

    // Falls back to the current year when nothing has rates at all, so the
    // default is always a year that appears in the list.
    const computable = financialYears.find((year) => year.rulesAvailable);

    return {
      today,
      currentFinancialYear: currentFy,
      currentAssessmentYear: FyCalendar.assessmentYearOf(currentFy),
      currentCalendarYear: currentCy,
      defaultFinancialYear: computable?.financialYear ?? currentFy,
      defaultCalendarYear:
        calendarYears.find((year) => year.isComplete)?.calendarYear ?? currentCy,
      financialYears,
      calendarYears,
    };
  },
};

/* --------------------------------------------------------------- templates */

export interface TemplateSummary {
  readonly name: string;
  readonly description: string;
  readonly assetClass: string;
  readonly columns: readonly string[];
  readonly guidance: string;
}

export const TemplateUC = {
  list(): readonly TemplateSummary[] {
    return TemplateRegistry.definitions().map((template) => ({
      name: template.name,
      description: template.description,
      assetClass: template.assetClass,
      columns: template.columns,
      guidance: template.guidance,
    }));
  },
  generate(name: string): string {
    return TemplateRegistry.generate(name);
  },
};

/* ------------------------------------------------------------------ ledger */

export const LedgerUC = {
  assets(): Promise<readonly Asset[]> {
    return AssetRepository.all();
  },
  liabilities(): Promise<readonly Liability[]> {
    return LiabilityRepository.all();
  },
  exits(): Promise<readonly ExitTransaction[]> {
    return ExitRepository.all();
  },
};

/* -------------------------------------------------------------- compliance */

export interface GenerateComplianceUCOps {
  scheduleFaA3(calendarYear: number): Promise<Result<readonly ScheduleFaA3Row[]>>;
  scheduleFaD(calendarYear: number): Promise<Result<readonly ScheduleFaDRow[]>>;
  scheduleAl(financialYear: FinancialYear): Promise<Result<ScheduleAl>>;
}

/** 31 December of the disclosure year — Schedule FA is calendar-aligned. */
const foreignSnapshotId = (calendarYear: number) => `FOR_31DEC${String(calendarYear)}`;
/** 31 March closing the financial year, e.g. FY 2025-26 → 31 Mar 2026. */
const domesticSnapshotId = (financialYear: FinancialYear) =>
  `DOM_31MAR${String(Number(financialYear.slice(0, 4)) + 1)}`;

export const GenerateComplianceUC: GenerateComplianceUCOps = {
  async scheduleFaA3(calendarYear: number): Promise<Result<readonly ScheduleFaA3Row[]>> {
    const snapshot = await SnapshotRepository.findById(foreignSnapshotId(calendarYear));
    if (snapshot === undefined) {
      return Err(
        new VaultStateError(
          `no 31-December ${String(calendarYear)} foreign snapshot exists; Schedule FA is generated from a frozen snapshot, not from live values`,
        ),
      );
    }

    /*
     * Table A3 requires the PEAK value reached during the calendar year, which
     * needs a daily price and rate series. This build records holdings and
     * closing values but no daily history, so there is nothing to take a maximum
     * over. Returning rows computed from the closing value alone would understate
     * the peak — and under the Black Money Act an understated foreign disclosure
     * is treated far more harshly than an understated domestic one, so this fails
     * loudly instead.
     */
    return Err(
      new VaultStateError(
        'Schedule FA Table A3 needs a daily price and exchange-rate history to compute peak value; this build does not yet record one',
      ),
    );
  },

  async scheduleFaD(calendarYear: number): Promise<Result<readonly ScheduleFaDRow[]>> {
    const snapshot = await SnapshotRepository.findById(foreignSnapshotId(calendarYear));
    if (snapshot === undefined) {
      return Err(
        new VaultStateError(
          `no 31-December ${String(calendarYear)} foreign snapshot exists; Schedule FA is generated from a frozen snapshot, not from live values`,
        ),
      );
    }
    // Foreign bank and custodial accounts are not modelled as assets yet, so
    // there is genuinely nothing to disclose rather than nothing recorded.
    return ScheduleFaGenerator.tableD({ foreignSnapshot: snapshot, calendarYear, accounts: [] });
  },

  async scheduleAl(financialYear: FinancialYear): Promise<Result<ScheduleAl>> {
    const snapshot = await SnapshotRepository.findById(domesticSnapshotId(financialYear));
    if (snapshot === undefined) {
      return Err(
        new VaultStateError(
          `no 31-March snapshot exists for FY ${financialYear}; Schedule AL reports year-end positions and is generated from that snapshot`,
        ),
      );
    }

    const profile = profileFor(financialYear);
    if (!profile.ok) return profile;

    const [assets, liabilities] = await Promise.all([
      AssetRepository.all(),
      LiabilityRepository.all(),
    ]);

    return ScheduleAlGenerator.generate({
      domesticSnapshot: snapshot,
      totalIncome: profile.value.grossSalary,
      // Schedule AL is filed with the return for the ASSESSMENT year (FY + 1).
      assessmentYear: FyCalendar.assessmentYearOf(financialYear),
      items: ScheduleAlGenerator.itemsFrom({ assets, liabilities }),
    });
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
