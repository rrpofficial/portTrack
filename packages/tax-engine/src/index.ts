/**
 * tax-engine — slabs, surcharge, marginal relief, cess, capital gains, advance
 * tax, HNI classification and foreign tax credit. Pure.
 *
 * Every rate and threshold comes from the FY rule table (ADR-005); no rate
 * literal appears in this package's code.
 */
import { notImplemented, type FinancialYear, type Result } from '@porttrack/shared-kernel';
import { assertFilingReady, isProvisional, rulesFor } from './rule-table.js';
import { compare, compute as computeSlab, slabTax, taxableIncome, topMarginalRatePct } from './slabs.js';
import { apply as applySurcharge } from './surcharge.js';
import { classify, compute as computeCapitalGains, grandfatheredCost } from './capital-gains.js';
import { aggregate, withholdingCredit } from './other-sources.js';
import { compute as computeForeignTaxCredit } from './foreign-tax-credit.js';
import { classify as classifyHni } from './hni.js';
import { installment, schedule } from './advance-tax.js';
import type { Form16, IncomeProfile } from './types.js';

export * from './types.js';
export { AVAILABLE_YEARS } from './rule-table.js';

/** US-5.2 — FY-keyed rule sets (ADR-005). */
export const TaxRuleTable = { rulesFor, isProvisional, assertFilingReady };

/** US-5.4 — slab tax and regime comparison. */
export const SlabCalculator = { compute: computeSlab, compare, slabTax, taxableIncome, topMarginalRatePct };

/** US-5.5 — surcharge, marginal relief, cess. */
export const SurchargeCalculator = { apply: applySurcharge };

/** US-5.7 / US-5.8 — capital gains. */
export const CapitalGainsEngine = { classify, compute: computeCapitalGains, grandfatheredCost };

/** US-5.9 — other-sources income. */
export const OtherSourcesAggregator = { aggregate, withholdingCredit };

/** US-5.10 — quarterly advance tax. */
export const AdvanceTaxEngine = { installment, schedule };

/** US-5.6 — HNI classification (ADR-004). */
export const HniClassifier = { classify: classifyHni };

/** US-5.11 — DTAA relief. */
export const ForeignTaxCredit = { compute: computeForeignTaxCredit };

/* --------------------------------------------------- not yet implemented */

export interface Form16ParserOps {
  parse(buffer: Uint8Array): Result<Form16>;
  reconcile(form16: Form16): Result<void>;
  toIncomeProfile(form16: Form16, fy: FinancialYear): IncomeProfile;
}

export const Form16Parser: Form16ParserOps = {
  parse: () => notImplemented('US-5.3', 'Form16Parser.parse'),
  reconcile: () => notImplemented('US-5.3', 'Form16Parser.reconcile'),
  toIncomeProfile: () => notImplemented('US-5.3', 'Form16Parser.toIncomeProfile'),
};
