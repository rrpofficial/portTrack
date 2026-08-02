/**
 * Money — the only legal representation of a monetary amount (ADR-002).
 *
 * Backed by decimal.js. `amount` is carried as a decimal *string* so that a value
 * survives JSON serialisation, SQLite round-trips and content hashing without ever
 * passing through an IEEE-754 double. The ₹1.25 lakh LTCG exemption and the
 * surcharge thresholds are exact-boundary comparisons; float drift there is a
 * filing defect, not a rounding nuisance.
 */
import { Decimal } from 'decimal.js';
import { CurrencyMismatchError, InvalidAmountError } from './errors.js';
import type { Currency, Money, MoneyOps, RoundingMode } from './types.js';

/**
 * 40 significant digits: comfortably beyond any realistic portfolio (a ₹10,000 crore
 * net worth in paise is 15 digits) while leaving headroom for intermediate products
 * in XIRR and compounding calculations.
 */
const D = Decimal.clone({ precision: 40, toExpNeg: -30, toExpPos: 40 });

const ROUNDING: Readonly<Record<RoundingMode, Decimal.Rounding>> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
};

function toDecimal(money: Money): InstanceType<typeof D> {
  return new D(money.amount);
}

function parse(amount: string | number, currency: Currency): InstanceType<typeof D> {
  let value: InstanceType<typeof D>;
  try {
    // A number literal is converted via its shortest round-trip string, so
    // Money.of(1234.56) is exactly 1234.56 rather than 1234.5600000000000591.
    value = new D(typeof amount === 'number' ? String(amount) : amount.trim());
  } catch {
    throw new InvalidAmountError(`"${String(amount)}" is not a valid ${currency} amount`);
  }
  if (!value.isFinite()) {
    throw new InvalidAmountError(`${String(amount)} is not a finite ${currency} amount`);
  }
  return value;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(
      `cannot combine ${a.currency} with ${b.currency}: convert explicitly via the FX engine`,
    );
  }
}

const make = (value: InstanceType<typeof D>, currency: Currency): Money => ({
  amount: value.toFixed(),
  currency,
});

export const MoneyImpl: MoneyOps = {
  of: (amount, currency) => make(parse(amount, currency), currency),

  add: (a, b) => {
    assertSameCurrency(a, b);
    return make(toDecimal(a).plus(toDecimal(b)), a.currency);
  },

  subtract: (a, b) => {
    assertSameCurrency(a, b);
    return make(toDecimal(a).minus(toDecimal(b)), a.currency);
  },

  multiply: (a, factor) => make(toDecimal(a).times(parse(factor, a.currency)), a.currency),

  divide: (a, divisor) => {
    const d = parse(divisor, a.currency);
    if (d.isZero()) throw new InvalidAmountError('division by zero');
    return make(toDecimal(a).dividedBy(d), a.currency);
  },

  compare: (a, b) => {
    assertSameCurrency(a, b);
    return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1;
  },

  equals: (a, b) => a.currency === b.currency && toDecimal(a).equals(toDecimal(b)),

  isZero: (a) => toDecimal(a).isZero(),

  negate: (a) => make(toDecimal(a).negated(), a.currency),

  round: (a, dp, mode) => make(toDecimal(a).toDecimalPlaces(dp, ROUNDING[mode]), a.currency),

  /**
   * Section 288B: tax payable is rounded to the nearest multiple of ₹10.
   * Exact halves round away from zero, matching the statutory reading.
   */
  roundToNearestTen: (a) =>
    make(toDecimal(a).dividedBy(10).toDecimalPlaces(0, Decimal.ROUND_HALF_UP as Decimal.Rounding).times(10), a.currency),

  zero: (currency) => make(new D(0), currency),

  sum: (items, currency) => {
    let total = new D(0);
    for (const item of items) {
      if (item.currency !== currency) {
        throw new CurrencyMismatchError(
          `cannot sum ${item.currency} into a ${currency} total: convert explicitly via the FX engine`,
        );
      }
      total = total.plus(toDecimal(item));
    }
    return make(total, currency);
  },
};
