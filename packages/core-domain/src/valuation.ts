/**
 * Portfolio valuation (US-1.7, US-1.15, PRD NFR-2).
 *
 * Prices and FX rates arrive through injected ports, not by reaching out — that is
 * what keeps this package pure and the sub-1.5s budget attainable: every rate is
 * resolved from an in-memory map, never per-lot I/O.
 *
 * Where no market price exists (real estate, unlisted shares, hand loans), the
 * position is valued at cost. That is a deliberate conservative default: inventing
 * a market value for an illiquid asset would corrupt net worth, and Schedule AL
 * wants cost anyway.
 */
import {
  Money,
  RateUnavailableError,
  type Clock,
  type Money as MoneyValue,
} from '@porttrack/shared-kernel';
import { Decimal } from 'decimal.js';
import { totalCostBasis } from './lots.js';
import { handLoanAccruedInterest, handLoanOutstandingPrincipal } from './accruals.js';
import { JURISDICTION, LIQUIDITY } from './taxonomy.js';
import type {
  Asset,
  AssetClass,
  Liability,
  PortfolioValuation,
  PriceQuote,
  PriceSource,
  FxSource,
  ValuationInput,
  ValuedPosition,
} from './types.js';

const INR = 'INR' as const;

function positionCostBasis(asset: Asset): MoneyValue {
  const lots = asset.lots.filter((lot) => new Decimal(lot.remainingQuantity).greaterThan(0));
  if (lots.length === 0) return Money.zero(asset.currency);
  // Cost of the units still held, plus the charges that formed the basis.
  const parts = lots.map((lot) => {
    const proportion = new Decimal(lot.remainingQuantity).dividedBy(lot.quantity);
    return Money.multiply(totalCostBasis(lot), proportion.toFixed());
  });
  return Money.sum(parts, asset.currency);
}

function heldQuantity(asset: Asset): string {
  return asset.lots
    .reduce((sum, lot) => sum.plus(lot.remainingQuantity), new Decimal(0))
    .toFixed();
}

function toInr(amount: MoneyValue, asOf: string, fx: FxSource | undefined): MoneyValue {
  if (amount.currency === INR) return amount;
  const rate = fx?.rateFor(amount.currency, asOf);
  if (rate === undefined) {
    // Never substitute 1.0 and never pass the foreign amount through: either would
    // understate net worth by roughly the exchange rate. Fail loudly instead.
    throw new RateUnavailableError(
      `no ${amount.currency}/INR valuation rate available for ${asOf}`,
    );
  }
  return Money.round(
    Money.of(new Decimal(amount.amount).times(rate).toFixed(), INR),
    2,
    'HALF_UP',
  );
}

function marketValueOf(
  asset: Asset,
  quantity: string,
  asOf: string,
  prices: PriceSource | undefined,
): { value: MoneyValue; quote: PriceQuote | undefined } {
  const quote = prices?.priceFor({
    assetId: asset.assetId,
    assetClass: asset.assetClass,
    asOf,
    ...(asset.isin === undefined ? {} : { isin: asset.isin }),
    ...(asset.symbol === undefined ? {} : { symbol: asset.symbol }),
  });

  if (quote === undefined) return { value: positionCostBasis(asset), quote: undefined };

  const value = Money.round(
    Money.multiply(quote.price, quantity),
    2,
    'HALF_UP',
  );
  return { value, quote };
}

export function value(input: ValuationInput): PortfolioValuation {
  const asOfDate = input.asOf.slice(0, 10);
  const positions: ValuedPosition[] = [];

  for (const asset of input.assets) {
    const quantity = heldQuantity(asset);
    let costBasis = positionCostBasis(asset);

    let native: MoneyValue;
    let navSource: ValuedPosition['navSource'];

    if (asset.assetClass === 'HAND_LOAN' && asset.handLoan) {
      // A loan receivable has no lots: its cost basis is the principal still owed,
      // and its value is that principal plus interest accrued to the valuation date.
      costBasis = handLoanOutstandingPrincipal(asset.handLoan, asOfDate);
      native = Money.add(costBasis, handLoanAccruedInterest(asset.handLoan, asOfDate));
    } else {
      const { value: marketValue, quote } = marketValueOf(asset, quantity, asOfDate, input.prices);
      native = marketValue;
      navSource = quote?.source;
    }

    positions.push({
      assetId: asset.assetId,
      assetClass: asset.assetClass,
      jurisdiction: JURISDICTION[asset.assetClass],
      quantity,
      marketValue: toInr(native, asOfDate, input.fx),
      costBasis: toInr(costBasis, asOfDate, input.fx),
      ...(navSource === undefined ? {} : { navSource }),
      ...(LIQUIDITY[asset.assetClass] === undefined
        ? {}
        : { liquidity: LIQUIDITY[asset.assetClass] }),
    });
  }

  const byAssetClass: Partial<Record<AssetClass, MoneyValue>> = {};
  for (const position of positions) {
    const running = byAssetClass[position.assetClass];
    byAssetClass[position.assetClass] =
      running === undefined ? position.marketValue : Money.add(running, position.marketValue);
  }

  const grossAssets = Money.sum(
    positions.map((p) => p.marketValue),
    INR,
  );
  const totalLiabilities = Money.sum(
    input.liabilities.map((liability: Liability) =>
      toInr(liability.principalOutstanding, asOfDate, input.fx),
    ),
    INR,
  );

  return {
    asOf: input.asOf,
    positions,
    grossAssets,
    totalLiabilities,
    netWorth: Money.subtract(grossAssets, totalLiabilities),
    byAssetClass,
  };
}

/** Convenience for callers holding a Clock rather than an explicit instant. */
export function valueNow(
  input: Omit<ValuationInput, 'asOf'> & { clock: Clock },
): PortfolioValuation {
  return value({ ...input, asOf: input.clock.now() });
}
