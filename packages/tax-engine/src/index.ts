/**
 * tax-engine — slabs, surcharge, marginal relief, cess, capital gains, advance tax.
 * All rates come from FY-keyed rule data (ADR-005). No rate literal lives in code.
 */
import {
  notImplemented,
  type AssessmentYear,
  type FinancialYear,
  type IsoDate,
  type Money,
  type Percentage,
  type Quarter,
  type Result,
} from '@porttrack/shared-kernel';
import type { AssetClass, ExitTransaction, IncomeEvent } from '@porttrack/core-domain';

export type TaxRegime = 'OLD_REGIME' | 'NEW_REGIME';
export type GainKind = 'STCG' | 'LTCG' | 'VDA_GAIN' | 'SLAB';

export interface SlabBand {
  readonly upTo: string | null;
  readonly ratePct: Percentage;
}

export interface SurchargeBand {
  readonly above: string;
  readonly ratePct: Percentage;
}

export interface TaxRuleSet {
  readonly financialYear: FinancialYear;
  readonly slabs: Readonly<Record<TaxRegime, readonly SlabBand[]>>;
  readonly standardDeduction: Readonly<Record<TaxRegime, Money>>;
  readonly surchargeBands: readonly SurchargeBand[];
  readonly surchargeCapOnCapitalGainsPct: Percentage;
  readonly cessPct: Percentage;
  readonly ltcgExemptionLimit: Money;
  readonly ltcgRatePct: Percentage;
  readonly stcgListedEquityRatePct: Percentage;
  readonly vdaRatePct: Percentage;
  readonly holdingPeriodMonths: Readonly<Partial<Record<AssetClass, number>>>;
  readonly hniIncomeThreshold: Money;
  readonly hniNetWorthThreshold: Money;
  readonly scheduleAlIncomeThreshold: Money;
}

export interface IncomeProfile {
  readonly financialYear: FinancialYear;
  readonly assessmentYear: AssessmentYear;
  readonly grossSalary: Money;
  readonly exemptAllowances: Money;
  readonly chapterViaDeductions: Money;
  readonly housePropertyIncome: Money;
  readonly otherSourcesIncome: Money;
  readonly tdsRemitted: Money;
  readonly tcsCollected: Money;
}

export interface Form16 {
  readonly partA: {
    readonly quarterlyTds: readonly { readonly quarter: Quarter; readonly amount: Money }[];
    readonly totalTds: Money;
    readonly panRef: string;
    readonly tanRef: string;
  };
  readonly partB: {
    readonly grossSalary: Money;
    readonly exemptAllowances: Money;
    readonly chapterViaDeductions: Money;
    readonly totalTds: Money;
  };
}

export interface TraceLine {
  readonly label: string;
  readonly ruleRef: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly amount: Money;
}

export interface TaxComputation {
  readonly regime: TaxRegime;
  readonly totalIncome: Money;
  readonly baseTax: Money;
  readonly capitalGainsTax: Money;
  readonly surcharge: Money;
  readonly marginalRelief: Money;
  readonly cess: Money;
  readonly totalLiability: Money;
  readonly trace: readonly TraceLine[];
}

export interface RegimeComparison {
  readonly old: TaxComputation;
  readonly new: TaxComputation;
  readonly recommended: TaxRegime;
  readonly deductionsForgone: readonly string[];
}

export interface ClassifiedGain {
  readonly txnId: string;
  readonly assetClass: AssetClass;
  readonly kind: GainKind;
  readonly holdingPeriodDays: number;
  readonly gain: Money;
  readonly ratePct: Percentage;
}

export interface CapitalGainsResult {
  readonly gains: readonly ClassifiedGain[];
  readonly ltcgBeforeExemption: Money;
  readonly ltcgExemptionApplied: Money;
  readonly taxableLtcg: Money;
  readonly taxableStcg: Money;
  readonly tax: Money;
}

export interface AdvanceTaxInstallment {
  readonly quarter: Quarter;
  readonly dueDate: IsoDate;
  readonly cumulativePercentage: Percentage;
  readonly totalLiability: Money;
  readonly cumulativeRequired: Money;
  readonly tdsCredit: Money;
  readonly alreadyPaid: Money;
  readonly netPayable: Money;
}

export interface HniClassification {
  readonly isHni: boolean;
  readonly reason: 'INCOME_ABOVE_50L' | 'NET_WORTH_ABOVE_10CR' | 'NOT_HNI';
  readonly scheduleAlRequired: boolean;
}

/* --------------------------------------------------------------- contracts */

export interface TaxRuleTableOps {
  rulesFor(fy: FinancialYear): Result<TaxRuleSet>;
}

export interface Form16ParserOps {
  parse(buffer: Uint8Array): Result<Form16>;
  reconcile(form16: Form16): Result<void>;
  toIncomeProfile(form16: Form16, fy: FinancialYear): IncomeProfile;
}

export interface SlabCalculatorOps {
  compute(income: IncomeProfile, regime: TaxRegime, rules: TaxRuleSet): TaxComputation;
  compare(income: IncomeProfile, rules: TaxRuleSet): RegimeComparison;
}

export interface SurchargeCalculatorOps {
  apply(input: {
    baseTax: Money;
    capitalGainsTax: Money;
    totalIncome: Money;
    rules: TaxRuleSet;
  }): {
    readonly surcharge: Money;
    readonly marginalRelief: Money;
    readonly cess: Money;
    readonly total: Money;
    readonly trace: readonly TraceLine[];
  };
}

export interface CapitalGainsEngineOps {
  classify(exit: ExitTransaction, assetClass: AssetClass, rules: TaxRuleSet): ClassifiedGain;
  compute(
    exits: readonly ExitTransaction[],
    assetClasses: Readonly<Record<string, AssetClass>>,
    rules: TaxRuleSet,
  ): CapitalGainsResult;
}

export interface OtherSourcesAggregatorOps {
  aggregate(
    events: readonly IncomeEvent[],
    accruals: readonly { readonly label: string; readonly amount: Money }[],
  ): { readonly total: Money; readonly items: readonly TraceLine[] };
}

export interface AdvanceTaxEngineOps {
  installment(input: {
    financialYear: FinancialYear;
    quarter: Quarter;
    income: IncomeProfile;
    exits: readonly ExitTransaction[];
    assetClasses: Readonly<Record<string, AssetClass>>;
    alreadyPaid: Money;
    rules: TaxRuleSet;
  }): Result<AdvanceTaxInstallment>;
}

export interface HniClassifierOps {
  classify(input: { totalIncome: Money; netWorth: Money; rules: TaxRuleSet }): HniClassification;
}

export interface ForeignTaxCreditOps {
  compute(input: {
    foreignTaxPaid: Money;
    indianTaxOnDoublyTaxedIncome: Money;
  }): { readonly credit: Money; readonly nonCreditable: Money };
}

/* ------------------------------------------------------------------- stubs */

export const TaxRuleTable: TaxRuleTableOps = {
  rulesFor: () => notImplemented('US-5.2', 'TaxRuleTable.rulesFor'),
};
export const Form16Parser: Form16ParserOps = {
  parse: () => notImplemented('US-5.3', 'Form16Parser.parse'),
  reconcile: () => notImplemented('US-5.3', 'Form16Parser.reconcile'),
  toIncomeProfile: () => notImplemented('US-5.3', 'Form16Parser.toIncomeProfile'),
};
export const SlabCalculator: SlabCalculatorOps = {
  compute: () => notImplemented('US-5.4', 'SlabCalculator.compute'),
  compare: () => notImplemented('US-5.4', 'SlabCalculator.compare'),
};
export const SurchargeCalculator: SurchargeCalculatorOps = {
  apply: () => notImplemented('US-5.5', 'SurchargeCalculator.apply'),
};
export const CapitalGainsEngine: CapitalGainsEngineOps = {
  classify: () => notImplemented('US-5.7', 'CapitalGainsEngine.classify'),
  compute: () => notImplemented('US-5.8', 'CapitalGainsEngine.compute'),
};
export const OtherSourcesAggregator: OtherSourcesAggregatorOps = {
  aggregate: () => notImplemented('US-5.9', 'OtherSourcesAggregator.aggregate'),
};
export const AdvanceTaxEngine: AdvanceTaxEngineOps = {
  installment: () => notImplemented('US-5.10', 'AdvanceTaxEngine.installment'),
};
export const HniClassifier: HniClassifierOps = {
  classify: () => notImplemented('US-5.6', 'HniClassifier.classify'),
};
export const ForeignTaxCredit: ForeignTaxCreditOps = {
  compute: () => notImplemented('US-5.11', 'ForeignTaxCredit.compute'),
};
