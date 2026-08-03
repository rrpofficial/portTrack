/**
 * Mutual fund tax character (US-1.7 / US-5.7).
 *
 * A single `DOMESTIC_MUTUAL_FUND` asset class covers schemes taxed three
 * different ways. Splitting it into sibling asset classes was considered and
 * rejected: the real discriminator is equity allocation, not the marketing
 * category, so separate classes would look correct while still being unable to
 * place a hybrid scheme. Jurisdiction, Schedule AL mapping and allocation
 * reporting are also identical across all of them — only tax differs.
 *
 * So the class stays one, and the tax character is derived here.
 *
 * ⚠ THRESHOLDS ARE STRUCTURAL, NOT STATUTORY. The 65% and 35% equity bands
 * below describe the SHAPE of the rule. The operative percentages, the effective
 * dates and the rates they map to changed in both the 2023 and 2024 Finance Acts
 * and MUST be verified against the current Act before any filing artifact is
 * produced — they live in the FY rule table (US-5.2), not here.
 */
import type { MfSchemeCategory, MfTaxCharacter, TaxSubject } from './types.js';

export interface EquityBands {
  /** At or above this equity allocation a scheme is equity-oriented. */
  readonly equityOrientedMinPct: number;
  /** Below this it is debt-oriented; between the two it is the middle band. */
  readonly debtOrientedMaxPct: number;
}

export const DEFAULT_EQUITY_BANDS: EquityBands = {
  equityOrientedMinPct: 65,
  debtOrientedMaxPct: 35,
};

/** Categories whose mandate guarantees them the equity side of the band. */
const ALWAYS_EQUITY_ORIENTED: ReadonlySet<MfSchemeCategory> = new Set([
  'EQUITY',
  // Structured to hold >=65% equity while hedging it away. Cash-like returns,
  // equity taxation — the reason the category exists.
  'ARBITRAGE',
  'SOLUTION_ORIENTED',
]);

const ALWAYS_DEBT_ORIENTED: ReadonlySet<MfSchemeCategory> = new Set(['DEBT', 'LIQUID']);

export function taxCharacterFor(
  category: MfSchemeCategory,
  equityAllocationPct?: string,
  bands: EquityBands = DEFAULT_EQUITY_BANDS,
): MfTaxCharacter {
  if (ALWAYS_EQUITY_ORIENTED.has(category)) return 'EQUITY_ORIENTED';
  if (ALWAYS_DEBT_ORIENTED.has(category)) return 'DEBT_ORIENTED';

  // HYBRID: placement depends entirely on how much equity it actually holds.
  const equity = equityAllocationPct === undefined ? undefined : Number(equityAllocationPct);
  if (equity === undefined || Number.isNaN(equity)) {
    // Unknown allocation is treated as debt-oriented: the conservative direction,
    // since debt treatment is the higher tax and will not understate a liability.
    return 'DEBT_ORIENTED';
  }
  if (equity >= bands.equityOrientedMinPct) return 'EQUITY_ORIENTED';
  if (equity < bands.debtOrientedMaxPct) return 'DEBT_ORIENTED';
  return 'HYBRID_MID_BAND';
}

/**
 * Tax character for any holding. Non-fund assets have none — their treatment
 * follows from the asset class alone.
 */
export function taxCharacterOf(subject: TaxSubject): MfTaxCharacter | undefined {
  if (subject.assetClass !== 'DOMESTIC_MUTUAL_FUND') return undefined;
  if (subject.schemeCategory === undefined) return undefined;
  return taxCharacterFor(subject.schemeCategory, subject.equityAllocationPct);
}
