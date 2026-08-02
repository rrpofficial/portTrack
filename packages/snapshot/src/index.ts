/**
 * snapshot — immutable content-addressed snapshots, the dual compliance
 * schedulers, variance analytics and return measures. Pure.
 */
import { canonicalJson, sha256 } from './canonical.js';
import {
  assertImmutable,
  assertNotFuture,
  build,
  hashOf,
  positionsInScope,
  verify,
} from './factory.js';
import { domesticSnapshotId, dueSnapshots, foreignSnapshotId } from './policy.js';
import { allocationShift, compare } from './delta.js';
import { absoluteReturn, cagr, xirr } from './returns.js';

export * from './types.js';
export type { BuildInput } from './factory.js';
export type { DueSnapshotOptions } from './policy.js';

/** US-3.2 / US-3.3 — statutory freeze points. */
export const CompliancePolicy = { dueSnapshots, domesticSnapshotId, foreignSnapshotId };

/** US-3.1 / US-3.4 — construction, freezing, verification. */
export const SnapshotFactory = {
  build,
  verify,
  assertImmutable,
  assertNotFuture,
  positionsInScope,
};

/** US-3.1 — canonical serialisation and hashing. */
export const ContentHasher = { hash: hashOf, canonicalJson, sha256 };

/** US-3.5 / US-3.6 — variance between two points in time. */
export const DeltaEngine = { compare };

/** US-3.7 — asset-class allocation movement. */
export const AllocationShift = { compute: allocationShift };

/** US-3.8 — XIRR, CAGR, absolute return. */
export const ReturnsCalculator = { xirr, cagr, absoluteReturn };
