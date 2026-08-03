/**
 * Duplicate detection (US-4.7).
 *
 * The natural key is the transaction's identity — instrument, date, side,
 * quantity, price — deliberately EXCLUDING provenance. Overlapping date-range
 * exports are the normal case (a user downloads Apr–Sep, then Jul–Dec), and the
 * same trade appearing at a different row of a different file is still the same
 * trade. Keying on file or row would duplicate every overlapping period.
 */
import type { ParsedTransaction } from './types.js';

export function naturalKey(txn: ParsedTransaction): string {
  return [
    txn.kind,
    txn.date,
    txn.isin ?? txn.symbol ?? txn.schemeName ?? txn.folioRef ?? '',
    txn.quantity,
    txn.pricePerUnit.amount,
    txn.pricePerUnit.currency,
  ].join('|');
}

export function partition(
  incoming: readonly ParsedTransaction[],
  existingKeys: readonly string[],
): { fresh: readonly ParsedTransaction[]; duplicates: readonly ParsedTransaction[] } {
  const seen = new Set(existingKeys);
  const fresh: ParsedTransaction[] = [];
  const duplicates: ParsedTransaction[] = [];

  for (const txn of incoming) {
    const key = naturalKey(txn);
    if (seen.has(key)) {
      duplicates.push(txn);
      continue;
    }
    // Added as we go so a file containing the same trade twice self-deduplicates.
    seen.add(key);
    fresh.push(txn);
  }
  return { fresh, duplicates };
}
