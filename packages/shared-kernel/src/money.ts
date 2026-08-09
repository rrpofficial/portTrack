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

/**
 * Digit grouping, currency symbols and whitespace, removed.
 *
 * Someone entering a lakh types `1,00,000`, and a Western export writes
 * `100,000` — both are the same number and neither is a mistake worth rejecting.
 * The comma is treated as a SEPARATOR, never as a decimal point: this product is
 * INR-first and Indian grouping is irregular (`1,00,000`, not `100,000`), so a
 * locale that means `1,5` to be one-and-a-half is not a reading this can support.
 * Only `.` is a decimal point.
 */
function normaliseAmount(raw: string): string {
  return raw
    .trim()
    .replace(/[₹$£€]/g, '')
    .replace(/\bRs\.?/gi, '')
    .replace(/[\s,_]/g, '')
    .trim();
}

export const MoneyImpl: MoneyOps = {
  of: (amount, currency) => make(parse(amount, currency), currency),

  /**
   * Reads user input into Money without throwing.
   *
   * `of` throws, which is right for a programming error but wrong for a form
   * field: an unvalidated string reaching storage is how `1,00,000` got written
   * into a vault and made an entire register unreadable. Every boundary that
   * accepts a typed or imported amount goes through here.
   */
  parse: (amount, currency) => {
    const raw = typeof amount === 'number' ? String(amount) : normaliseAmount(amount);
    if (raw.length === 0) {
      return { ok: false, error: new InvalidAmountError(`an amount is required`) };
    }
    try {
      const value = new D(raw);
      if (!value.isFinite()) {
        return {
          ok: false,
          error: new InvalidAmountError(`"${String(amount)}" is not a finite amount`),
        };
      }
      return { ok: true, value: make(value, currency) };
    } catch {
      return {
        ok: false,
        error: new InvalidAmountError(
          `"${String(amount)}" is not a valid amount — use digits, with . for decimals`,
        ),
      };
    }
  },

  /**
   * Best-effort canonicalisation for a value ALREADY in storage.
   *
   * Distinct from `parse` because it cannot fail: a stored amount that will not
   * read as a number is corrupt, and the only thing worse than showing it wrong
   * is refusing to show the rest of the ledger at all. Returns zero for anything
   * unreadable, so one bad row costs that row rather than every read after it.
   */
  fromStorage: (amount, currency) => {
    try {
      // Already a readable decimal: returned VERBATIM. Canonicalising here would
      // rewrite "12.50" as "12.5" — same value, different string, and snapshot
      // content hashes are taken over exactly these strings. Repair only what is
      // actually broken.
      new D(amount);
      return { amount, currency };
    } catch {
      // Not readable. Try to recover the number a human meant, and fall back to
      // zero rather than letting one bad row throw on every later read.
      try {
        return make(new D(normaliseAmount(amount)), currency);
      } catch {
        return make(new D(0), currency);
      }
    }
  },

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
