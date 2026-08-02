/**
 * Snapshot construction, freezing and verification (US-3.1, US-3.4, ADR-006).
 *
 * A snapshot is a compliance artifact. Three properties follow from that and are
 * enforced here rather than by convention:
 *
 *  1. It is deeply frozen, so a caller cannot mutate one by accident.
 *  2. Its id is its content hash, so tampering is detectable without a signature.
 *  3. Regenerating it and getting a different hash is an ERROR, not an update —
 *     silently rewriting last year's disclosure is the failure mode this prevents.
 */
import {
  Err,
  FutureSnapshotError,
  Ok,
  SnapshotDivergenceError,
  SnapshotImmutableError,
  type IsoDate,
  type IsoDateTime,
  type Result,
} from '@porttrack/shared-kernel';
import type { PortfolioValuation } from '@porttrack/core-domain';
import { sha256 } from './canonical.js';
import type { Snapshot, SnapshotPosition, SnapshotSpec } from './types.js';

export interface BuildInput {
  readonly spec: SnapshotSpec;
  readonly valuation: PortfolioValuation;
  readonly createdAt: IsoDateTime;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return Object.freeze(value);
}

/** Positions in scope for a snapshot: domestic-only, foreign-only, or everything. */
export function positionsInScope(
  valuation: PortfolioValuation,
  scope: SnapshotSpec['scope'],
): readonly SnapshotPosition[] {
  return valuation.positions.filter(
    (position) => scope === 'ALL' || position.jurisdiction === scope,
  );
}

export function build(input: BuildInput): Result<Snapshot> {
  const { spec, valuation, createdAt } = input;

  if (spec.asOf > createdAt) {
    return Err(
      new FutureSnapshotError(`cannot snapshot ${spec.asOf}, which is after ${createdAt}`),
    );
  }

  const positions = positionsInScope(valuation, spec.scope);
  const draft = {
    snapshotId: spec.snapshotId,
    kind: spec.kind,
    scope: spec.scope,
    asOf: spec.asOf,
    positions,
    totals: {
      netWorth: valuation.netWorth,
      grossAssets: valuation.grossAssets,
      liabilities: valuation.totalLiabilities,
      byAssetClass: valuation.byAssetClass,
    },
    createdAt,
    frozen: true as const,
  };

  return Ok(deepFreeze({ ...draft, contentHash: sha256(draft) }) as Snapshot);
}

/** Recomputes the hash over everything but `contentHash`. */
export function hashOf(snapshot: Omit<Snapshot, 'contentHash'>): string {
  return sha256(snapshot);
}

export function verify(snapshot: Snapshot): Result<void> {
  const { contentHash, ...rest } = snapshot;
  const recomputed = hashOf(rest);
  if (recomputed !== contentHash) {
    return Err(
      new SnapshotDivergenceError(
        `snapshot ${snapshot.snapshotId} does not match its content hash ` +
          `(stored ${contentHash}, recomputed ${recomputed})`,
      ),
    );
  }
  return Ok(undefined);
}

/**
 * Runs `mutation` and reports whether it was refused. A frozen object silently
 * ignores writes in sloppy mode and throws in strict mode; this normalises both
 * into an explicit failure so callers cannot proceed believing a change took.
 */
export function assertImmutable(snapshot: Snapshot, mutation: () => void): Result<void> {
  const before = hashOf({ ...snapshot, contentHash: undefined } as never);
  try {
    mutation();
  } catch {
    return Err(
      new SnapshotImmutableError(`snapshot ${snapshot.snapshotId} is frozen and cannot be modified`),
    );
  }
  const after = hashOf({ ...snapshot, contentHash: undefined } as never);
  if (before === after) {
    return Err(
      new SnapshotImmutableError(`snapshot ${snapshot.snapshotId} is frozen and cannot be modified`),
    );
  }
  // The mutation actually took effect — the freeze is not doing its job.
  return Ok(undefined);
}

/** Guards a custom snapshot request against a future date (US-3.4). */
export function assertNotFuture(asOf: IsoDate, today: IsoDate): Result<void> {
  if (asOf > today) {
    return Err(new FutureSnapshotError(`cannot snapshot ${asOf}: it is in the future`));
  }
  return Ok(undefined);
}
