/**
 * Projecting parsed statement rows onto the asset ledger (US-4.1).
 *
 * The parsers deliberately stop at "these are the rows". This is where rows
 * become holdings: a BUY opens a lot, a SELL consumes lots FIFO, a dividend
 * becomes an income event. It lives in `ingestion` rather than `app-services`
 * because it is a rule, not wiring, and rules belong in a domain package.
 *
 * Two properties matter more than completeness here:
 *
 *  1. **Identity is derived, not generated.** Asset and lot ids come from the
 *     statement content, so re-importing the same file merges into the same
 *     holdings instead of duplicating them (US-4.7).
 *  2. **Nothing is silently absorbed.** A row this cannot place — an account-level
 *     fee with no lot to attach to, a generic template row with no asset class —
 *     comes back in `unapplied` with a reason. Quietly folding an unattributable
 *     fee into some arbitrary lot would invent a cost basis, and an invented cost
 *     basis is indistinguishable from a real one once it is stored.
 */
import { Money, Ok, type Result } from '@porttrack/shared-kernel';
import {
  AssetRegistry,
  FifoAllocator,
  LotBook,
  isAssetClass,
  type AcquisitionLot,
  type Asset,
  type AssetClass,
  type ExitTransaction,
  type IncomeEvent,
} from '@porttrack/core-domain';
import type { ParsedTransaction, ParserName } from './types.js';

/** A row that parsed cleanly but could not be placed on the ledger. */
export interface UnappliedTransaction {
  readonly kind: ParsedTransaction['kind'];
  readonly date: string;
  readonly symbol?: string;
  readonly sourceRow: number;
  readonly reason: string;
}

export interface LedgerProjection {
  readonly assets: readonly Asset[];
  /** Disposals, recorded so they are neither re-applied nor lost to tax. */
  readonly exits: readonly ExitTransaction[];
  readonly unapplied: readonly UnappliedTransaction[];
}

/**
 * What a source format holds, when the format itself tells us. TEMPLATE is
 * absent on purpose: `parseTemplate` is a generic reader that does not preserve
 * which template it read, so guessing an asset class here would mislabel a hand
 * loan as equity — and asset class drives tax treatment.
 */
const PARSER_ASSET_CLASS: Readonly<Partial<Record<ParserName, AssetClass>>> = {
  ZERODHA_TRADEBOOK: 'DOMESTIC_EQUITY',
  ZERODHA_TAX_PNL: 'DOMESTIC_EQUITY',
  VESTED: 'FOREIGN_EQUITY',
  ETRADE: 'FOREIGN_EQUITY',
  CAMS: 'DOMESTIC_MUTUAL_FUND',
};

/** Equity compensation is its own asset class regardless of the broker. */
const KIND_ASSET_CLASS: Readonly<Partial<Record<ParsedTransaction['kind'], AssetClass>>> = {
  RSU_VEST: 'RSU',
  ESPP_PURCHASE: 'ESPP',
};

const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

function assetClassFor(
  transaction: ParsedTransaction,
  parser: ParserName,
): AssetClass | undefined {
  // A row that states its own class wins: a portTrack template says exactly what
  // it holds, which is more authoritative than anything the file format implies.
  if (transaction.assetClass !== undefined && isAssetClass(transaction.assetClass)) {
    return transaction.assetClass;
  }
  return KIND_ASSET_CLASS[transaction.kind] ?? PARSER_ASSET_CLASS[parser];
}

/**
 * Stable across imports of the same file, and across different files describing
 * the same holding: ISIN first because it identifies a security globally, then
 * symbol, then the opaque folio reference.
 *
 * **A hand loan is identified by the LOAN, not by the borrower.** Two loans to
 * the same person are two receivables: different principal, different rate,
 * different start date, and therefore different interest accruing on each. Keyed
 * on the borrower alone they collapsed into one asset carrying a single set of
 * terms, and the valuation — which reads one principal — silently reported only
 * the first, understating money lent by the whole of the second loan.
 *
 * The discriminator is the loan's own terms rather than its file position, so a
 * re-import, or the same loan exported in a different row order, still resolves
 * to the same asset.
 */
function assetIdFor(transaction: ParsedTransaction, assetClass: AssetClass): string {
  const key = transaction.isin ?? transaction.symbol ?? transaction.folioRef;
  const base = `ast_${slug(assetClass)}_${key === undefined ? 'unidentified' : slug(key)}`;

  if (transaction.handLoan === undefined) return base;
  return `${base}_${slug(transaction.handLoan.startDate)}_${slug(transaction.pricePerUnit.amount)}`;
}

/** Derived from provenance, so a re-import produces the identical lot id. */
function lotIdFor(transaction: ParsedTransaction): string {
  const digest = transaction.provenance.importedAt.replace('import:', '');
  return `lot_${digest}_${String(transaction.provenance.sourceRow).padStart(5, '0')}`;
}

interface Draft {
  asset: Asset;
  lots: AcquisitionLot[];
  income: IncomeEvent[];
}

function draftFor(
  drafts: Map<string, Draft>,
  assetId: string,
  assetClass: AssetClass,
  transaction: ParsedTransaction,
): Draft {
  const existing = drafts.get(assetId);
  if (existing !== undefined) return existing;

  const base: Asset = {
    assetId,
    assetClass,
    jurisdiction: AssetRegistry.jurisdictionOf(assetClass),
    currency: transaction.pricePerUnit.currency,
    ...(transaction.symbol === undefined || transaction.symbol.length === 0
      ? {}
      : { symbol: transaction.symbol }),
    ...(transaction.isin === undefined || transaction.isin.length === 0
      ? {}
      : { isin: transaction.isin }),
    ...(transaction.folioRef === undefined ? {} : { folioRef: transaction.folioRef }),
    lots: [],
    incomeEvents: [],
    corporateActions: [],
  };
  const draft: Draft = { asset: base, lots: [], income: [] };
  drafts.set(assetId, draft);
  return draft;
}

const ACQUISITION_KINDS = new Set<ParsedTransaction['kind']>([
  'BUY',
  'RSU_VEST',
  'ESPP_PURCHASE',
  'REINVESTMENT',
]);

export function projectToLedger(input: {
  readonly transactions: readonly ParsedTransaction[];
  readonly parser: ParserName;
  /** Holdings already in the vault, so an import merges rather than replaces. */
  readonly existing?: readonly Asset[];
  /** Disposals already recorded, so a re-import does not sell the same units twice. */
  readonly existingExits?: readonly ExitTransaction[];
}): Result<LedgerProjection> {
  const drafts = new Map<string, Draft>();
  for (const asset of input.existing ?? []) {
    drafts.set(asset.assetId, {
      asset,
      lots: [...asset.lots],
      income: [...asset.incomeEvents],
    });
  }

  const exits: ExitTransaction[] = [];
  const seenExits = new Set((input.existingExits ?? []).map((exit) => exit.txnId));

  const unapplied: UnappliedTransaction[] = [];
  const reject = (transaction: ParsedTransaction, reason: string): void => {
    unapplied.push({
      kind: transaction.kind,
      date: transaction.date,
      ...(transaction.symbol === undefined ? {} : { symbol: transaction.symbol }),
      sourceRow: transaction.provenance.sourceRow,
      reason,
    });
  };

  // Chronological, so FIFO sees lots in the order they were actually opened even
  // when a statement lists sells before the buys that funded them.
  const ordered = [...input.transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.provenance.sourceRow - b.provenance.sourceRow,
  );

  for (const transaction of ordered) {
    const assetClass = assetClassFor(transaction, input.parser);
    if (assetClass === undefined) {
      reject(
        transaction,
        'this source format does not identify an asset class; import it through a typed parser',
      );
      continue;
    }

    const assetId = assetIdFor(transaction, assetClass);

    if (ACQUISITION_KINDS.has(transaction.kind)) {
      const draft = draftFor(drafts, assetId, assetClass, transaction);

      // Loan terms arrive with the row that opens the loan, and belong to the
      // asset rather than to a lot.
      if (transaction.handLoan !== undefined && draft.asset.handLoan === undefined) {
        draft.asset = {
          ...draft.asset,
          handLoan: {
            assetId,
            borrowerRef: transaction.handLoan.borrowerRef,
            principal: transaction.pricePerUnit,
            interestRatePct: transaction.handLoan.interestRatePct,
            interestBasis: transaction.handLoan.interestBasis,
            startDate: transaction.handLoan.startDate,
            repayments: [],
          },
        };
      }

      const lot = LotBook.recordAcquisition({
        assetClass,
        tradeDate: transaction.date,
        quantity: transaction.quantity,
        pricePerUnit: transaction.pricePerUnit,
        lotId: lotIdFor(transaction),
        ...(transaction.fees === undefined ? {} : { fees: transaction.fees }),
        ...(transaction.otherCharges === undefined
          ? {}
          : { otherCharges: transaction.otherCharges }),
        ...(transaction.perquisiteValue === undefined
          ? {}
          : { perquisiteValue: transaction.perquisiteValue }),
      });
      if (!lot.ok) {
        reject(transaction, lot.error.message);
        continue;
      }
      // Idempotent: the same statement row never opens a second lot.
      if (!draft.lots.some((existing) => existing.lotId === lot.value.lotId)) {
        draft.lots.push(lot.value);
      }
      continue;
    }

    if (transaction.kind === 'SELL') {
      const draft = drafts.get(assetId);
      if (draft === undefined || draft.lots.length === 0) {
        reject(transaction, 'no holding to sell from; the matching purchase is not in the ledger');
        continue;
      }

      const txnId = `exit_${lotIdFor(transaction).replace('lot_', '')}`;
      // Applying the same disposal twice would deplete the holding twice, and
      // the second depletion looks exactly like a legitimate later sale.
      if (seenExits.has(txnId)) continue;

      const allocated = FifoAllocator.allocate(draft.lots, transaction.quantity);
      if (!allocated.ok) {
        reject(transaction, allocated.error.message);
        continue;
      }
      draft.lots = [...allocated.value.updatedLots];
      seenExits.add(txnId);

      const allocations = allocated.value.allocations;
      exits.push({
        txnId,
        assetId,
        exitDate: transaction.date,
        // FIFO's oldest consumed lot is the holding period's start.
        ...(allocations[0]?.acquisitionDate === undefined
          ? {}
          : { acquisitionDate: allocations[0].acquisitionDate }),
        quantity: transaction.quantity,
        pricePerUnit: transaction.pricePerUnit,
        fees: Money.zero(transaction.pricePerUnit.currency),
        stt: Money.zero(transaction.pricePerUnit.currency),
        allocations,
      });
      continue;
    }

    if (transaction.kind === 'DIVIDEND') {
      const draft = drafts.get(assetId);
      if (draft === undefined) {
        reject(transaction, 'dividend for a holding that is not in the ledger');
        continue;
      }
      const gross = Money.multiply(transaction.pricePerUnit, transaction.quantity);
      const eventId = `inc_${lotIdFor(transaction).replace('lot_', '')}`;
      if (!draft.income.some((event) => event.eventId === eventId)) {
        draft.income.push({
          eventId,
          assetId,
          kind:
            AssetRegistry.jurisdictionOf(assetClass) === 'FOREIGN'
              ? 'DIVIDEND_FOREIGN'
              : 'DIVIDEND_DOMESTIC',
          date: transaction.date,
          grossAmount: gross,
          taxWithheld: Money.zero(gross.currency),
          netAmount: gross,
          // Withholding is not on the row; claiming credit for tax we cannot see
          // would overstate the relief.
          eligibleForForeignTaxCredit: false,
        });
      }
      continue;
    }

    reject(
      transaction,
      'an account-level fee cannot be attributed to a specific lot; record it manually',
    );
  }

  const assets = [...drafts.values()].map((draft) => ({
    ...draft.asset,
    lots: draft.lots,
    incomeEvents: draft.income,
  }));

  return Ok({ assets, exits, unapplied });
}

/** The acquisition kind a stored lot must have come from. */
const ASSET_CLASS_KIND: Readonly<Partial<Record<AssetClass, ParsedTransaction['kind']>>> = {
  RSU: 'RSU_VEST',
  ESPP: 'ESPP_PURCHASE',
};

/**
 * Natural keys for everything already on the ledger, so a re-import recognises
 * its own earlier rows (US-4.7).
 *
 * Reconstructed from stored holdings rather than from a table of imported rows:
 * the ledger is the record, and a separate import journal would be a second
 * source of truth that could disagree with it.
 */
export function ledgerNaturalKeys(
  assets: readonly Asset[],
  exits: readonly ExitTransaction[] = [],
): readonly string[] {
  const keys: string[] = [];
  const identityOf = new Map(
    assets.map((asset) => [asset.assetId, asset.isin ?? asset.symbol ?? asset.folioRef ?? '']),
  );

  for (const asset of assets) {
    const acquisitionKind = ASSET_CLASS_KIND[asset.assetClass] ?? 'BUY';
    const identity = asset.isin ?? asset.symbol ?? asset.folioRef ?? '';

    for (const lot of asset.lots) {
      keys.push(
        [
          acquisitionKind,
          lot.acquisitionDate,
          identity,
          // The ORIGINAL quantity: `remainingQuantity` shrinks as the holding is
          // sold, and keying on it would make an earlier buy look like a new one
          // the moment any of it was disposed of.
          lot.quantity,
          lot.costPerUnit.amount,
          lot.costPerUnit.currency,
        ].join('|'),
      );
    }

    /*
     * Income events are deliberately absent. A stored event keeps only the gross
     * amount — the per-unit price and unit count that formed the natural key are
     * not recoverable from it, so any key built here would be a guess. A guessed
     * key that happens to collide would suppress a genuine second dividend, which
     * understates income; the projection's provenance-derived event id already
     * makes re-importing the SAME file idempotent, which is the case that matters.
     */
  }

  // Disposals. Without these a re-imported statement's sells look new, and FIFO
  // depletes the holding a second time — the ledger then understates the
  // position and overstates realised gains, with nothing to show it happened.
  for (const exit of exits) {
    keys.push(
      [
        'SELL',
        exit.exitDate,
        identityOf.get(exit.assetId) ?? '',
        exit.quantity,
        exit.pricePerUnit.amount,
        exit.pricePerUnit.currency,
      ].join('|'),
    );
  }

  return keys;
}
