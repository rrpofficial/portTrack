/**
 * Capital gains classification and computation (US-5.7, US-5.8, PRD FR-5.2).
 *
 * Classification keys off holding period AND tax character — never the asset
 * class alone (ADR-016). A debt-oriented and an equity-oriented mutual fund share
 * an asset class and are taxed completely differently.
 *
 * Three rules that are individually easy to miss:
 *   • The ₹1.25 lakh LTCG exemption is ANNUAL, not per transaction.
 *   • Grandfathering substitutes the higher of cost and 31-Jan-2018 FMV, but caps
 *     the substitute at the sale price so it can never manufacture a loss.
 *   • Foreign gains are measured in INR at the Rule 115 rate, never the trade-date
 *     valuation rate (ADR-003) — using the latter taxes currency movement.
 */
import { Money, type Currency, type IsoDate, type Money as MoneyValue } from '@porttrack/shared-kernel';
import { Decimal } from 'decimal.js';
import {
  days30360,
  taxCharacterOf,
  type AssetClass,
  type ExitTransaction,
  type TaxSubject,
} from '@porttrack/core-domain';
import { DualRateConverter } from '@porttrack/fx-itbr';
import type { CapitalGainsResult, ClassifiedGain, GainKind, TaxRuleSet } from './types.js';

const INR = 'INR' as const;
const money = (value: Decimal, currency: Currency = INR): MoneyValue =>
  Money.round(Money.of(value.toFixed(), currency), 2, 'HALF_UP');

/** Classes whose returns are slab-taxed however long they are held. */
const ALWAYS_SLAB: ReadonlySet<AssetClass> = new Set([
  'FIXED_DEPOSIT',
  'RECURRING_DEPOSIT',
  'HAND_LOAN',
  'CHIT_FUND',
  'BANK_BALANCE',
  'CASH_IN_HAND',
  'EPF',
  'VPF',
  'PPF',
  'NPS_TIER_I',
  'NPS_TIER_II',
  'GRATUITY',
]);

const EQUITY_STCG_CLASSES: ReadonlySet<AssetClass> = new Set(['DOMESTIC_EQUITY', 'DOMESTIC_ETF']);

const asSubject = (subject: AssetClass | TaxSubject): TaxSubject =>
  typeof subject === 'string' ? { assetClass: subject } : subject;

function acquisitionOf(exit: ExitTransaction): IsoDate {
  if (exit.acquisitionDate !== undefined) return exit.acquisitionDate;
  const dated = exit.allocations
    .map((allocation) => allocation.acquisitionDate)
    .filter((date): date is IsoDate => date !== undefined)
    .sort();
  // Oldest allocated lot governs, matching the FIFO order the exit consumed.
  return dated[0] ?? exit.exitDate;
}

export function classify(
  exit: ExitTransaction,
  subject: AssetClass | TaxSubject,
  rules: TaxRuleSet,
): ClassifiedGain {
  const target = asSubject(subject);
  const { assetClass } = target;
  const character = taxCharacterOf(target);
  const acquiredOn = acquisitionOf(exit);
  const days = days30360(acquiredOn, exit.exitDate);
  const months = days / 30;

  const base = {
    txnId: exit.txnId,
    assetClass,
    holdingPeriodDays: days,
    gain: money(new Decimal(exit.pricePerUnit.amount), exit.pricePerUnit.currency),
    ...(character === undefined ? {} : { taxCharacter: character }),
  };
  const emit = (kind: GainKind, ratePct: string): ClassifiedGain => ({ ...base, kind, ratePct });

  if (assetClass === 'CRYPTO') return emit('VDA_GAIN', rules.vdaRatePct);
  if (ALWAYS_SLAB.has(assetClass)) return emit('SLAB', 'SLAB');
  // Debt-oriented funds are slab-taxed however long they are held; an arbitrage
  // fund gets equity treatment despite behaving like cash (ADR-016).
  if (character === 'DEBT_ORIENTED') return emit('SLAB', 'SLAB');

  const threshold = rules.holdingPeriodMonths[assetClass] ?? 24;
  if (months <= threshold) {
    const equityLike = EQUITY_STCG_CLASSES.has(assetClass) || character === 'EQUITY_ORIENTED';
    return emit('STCG', equityLike ? rules.stcgListedEquityRatePct : 'SLAB');
  }
  return emit('LTCG', rules.ltcgRatePct);
}

/**
 * Cost of acquisition after grandfathering: the higher of actual cost and the
 * 31-Jan-2018 FMV, capped at the sale price so the substitution cannot create a
 * loss that never economically occurred.
 */
export function grandfatheredCost(
  actualCost: MoneyValue,
  fmv31Jan2018: MoneyValue | undefined,
  salePrice: MoneyValue,
): MoneyValue {
  if (fmv31Jan2018 === undefined) return actualCost;
  const higher = Money.compare(fmv31Jan2018, actualCost) > 0 ? fmv31Jan2018 : actualCost;
  return Money.compare(higher, salePrice) > 0 ? salePrice : higher;
}

/** Realised gain in the holding's own currency, before any INR conversion. */
function realisedGain(exit: ExitTransaction): MoneyValue {
  if (exit.allocations.length === 0) {
    // No lot detail: the exit amount IS the realised gain. This is the normal
    // shape for broker Tax P&L imports, which report net gain rather than lots.
    return exit.pricePerUnit;
  }
  const total = exit.allocations.reduce((sum, allocation) => {
    const cost = grandfatheredCost(
      allocation.costPerUnit,
      allocation.grandfatheredFmv,
      exit.pricePerUnit,
    );
    const perUnit = new Decimal(exit.pricePerUnit.amount).minus(cost.amount);
    return sum.plus(perUnit.times(allocation.quantity));
  }, new Decimal(0));
  return money(total, exit.pricePerUnit.currency);
}

/** Converts a realised gain to INR at the Rule 115 rate — never the trade-date rate. */
function toTaxableInr(exit: ExitTransaction, gain: MoneyValue): MoneyValue {
  if (gain.currency === INR) return gain;
  // Recorded at exit time, already Rule 115 based (ADR-003).
  if (exit.taxableInr !== undefined) return exit.taxableInr;

  const rates = DualRateConverter.ratesFor(gain.currency, exit.exitDate);
  if (!rates.ok) return gain;
  return DualRateConverter.convert(gain, rates.value).taxableInr;
}

export function compute(
  exits: readonly ExitTransaction[],
  subjects: Readonly<Record<string, AssetClass | TaxSubject>>,
  rules: TaxRuleSet,
): CapitalGainsResult {
  const gains: ClassifiedGain[] = [];

  for (const exit of exits) {
    // Keyed by transaction first: one asset can hold lots of differing character.
    const subject = subjects[exit.txnId] ?? subjects[exit.assetId];
    if (subject === undefined) continue;

    const classified = classify(exit, subject, rules);
    gains.push({ ...classified, gain: toTaxableInr(exit, realisedGain(exit)) });
  }

  const sumOf = (kind: GainKind): Decimal =>
    gains
      .filter((gain) => gain.kind === kind)
      .reduce((total, gain) => total.plus(gain.gain.amount), new Decimal(0));

  const ltcgBefore = sumOf('LTCG');
  const exemptionApplied = Decimal.min(
    Decimal.max(0, ltcgBefore),
    new Decimal(rules.ltcgExemptionLimit.amount),
  );
  const taxableLtcg = Decimal.max(0, ltcgBefore.minus(exemptionApplied));
  const taxableStcg = sumOf('STCG');
  const vda = sumOf('VDA_GAIN');

  const tax = taxableLtcg
    .times(rules.ltcgRatePct)
    .dividedBy(100)
    .plus(taxableStcg.times(rules.stcgListedEquityRatePct).dividedBy(100))
    .plus(vda.times(rules.vdaRatePct).dividedBy(100));

  return {
    gains,
    ltcgBeforeExemption: money(ltcgBefore),
    ltcgExemptionApplied: money(exemptionApplied),
    taxableLtcg: money(taxableLtcg),
    taxableStcg: money(taxableStcg),
    tax: money(tax),
  };
}
