/**
 * snapshot — immutable content-addressed snapshots, compliance date policy,
 * delta/variance analytics, XIRR. Pure.
 */
import {
  notImplemented,
  type IsoDate,
  type IsoDateTime,
  type Money,
  type Percentage,
  type Quantity,
  type Result,
} from '@porttrack/shared-kernel';
import type { AssetClass, Jurisdiction, PortfolioValuation, ValuedPosition } from '@porttrack/core-domain';

export type SnapshotKind = 'DOMESTIC_COMPLIANCE' | 'FOREIGN_COMPLIANCE' | 'CUSTOM';
export type SnapshotScope = 'DOMESTIC' | 'FOREIGN' | 'ALL';

export interface SnapshotPosition extends ValuedPosition {
  readonly jurisdiction: Jurisdiction;
}

export interface Snapshot {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly scope: SnapshotScope;
  readonly asOf: IsoDateTime;
  readonly positions: readonly SnapshotPosition[];
  readonly totals: {
    readonly netWorth: Money;
    readonly grossAssets: Money;
    readonly liabilities: Money;
    readonly byAssetClass: Readonly<Partial<Record<AssetClass, Money>>>;
  };
  readonly contentHash: string;
  readonly createdAt: IsoDateTime;
  readonly frozen: true;
  readonly supersededRateAvailable?: boolean;
}

export interface SnapshotSpec {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly scope: SnapshotScope;
  readonly asOf: IsoDateTime;
}

export type MovementBucket = 'NEW' | 'LIQUIDATED' | 'INCREASED' | 'DECREASED' | 'UNCHANGED';

export interface PositionDelta {
  readonly assetId: string;
  readonly bucket: MovementBucket;
  readonly quantityBefore: Quantity;
  readonly quantityAfter: Quantity;
  readonly valueBefore: Money;
  readonly valueAfter: Money;
  readonly valueDelta: Money;
  readonly valueDeltaPct: Percentage;
  /** Price movement and currency movement attributed separately. */
  readonly priceEffect?: Money;
  readonly currencyEffect?: Money;
}

export interface AllocationRow {
  readonly assetClass: AssetClass;
  readonly pctBefore: Percentage;
  readonly pctAfter: Percentage;
  readonly shiftPct: Percentage;
}

export interface VarianceReport {
  readonly netWorthBefore: Money;
  readonly netWorthAfter: Money;
  readonly netWorthDelta: Money;
  readonly netWorthDeltaPct: Percentage;
  readonly positions: readonly PositionDelta[];
  readonly topGainers: readonly PositionDelta[];
  readonly newAdditions: readonly PositionDelta[];
  readonly liquidations: readonly PositionDelta[];
  readonly allocation: readonly AllocationRow[];
}

export interface CashFlow {
  readonly date: IsoDate;
  readonly amount: Money;
}

export interface CompliancePolicyOps {
  /** Snapshots whose IST EOD boundary has been crossed and which do not yet exist. */
  dueSnapshots(now: IsoDateTime, existing: readonly string[]): readonly SnapshotSpec[];
  domesticSnapshotId(year: number): string;
  foreignSnapshotId(year: number): string;
}

export interface SnapshotFactoryOps {
  build(input: {
    spec: SnapshotSpec;
    valuation: PortfolioValuation;
    createdAt: IsoDateTime;
  }): Result<Snapshot>;
  /** Rejects any mutation attempt (ADR-006). */
  assertImmutable(snapshot: Snapshot, mutation: () => void): Result<void>;
  verify(snapshot: Snapshot): Result<void>;
}

export interface ContentHasherOps {
  hash(snapshot: Omit<Snapshot, 'contentHash'>): string;
  canonicalJson(value: unknown): string;
}

export interface DeltaEngineOps {
  compare(before: Snapshot, after: Snapshot | PortfolioValuation): VarianceReport;
}

export interface AllocationShiftOps {
  compute(before: Snapshot, after: Snapshot | PortfolioValuation): readonly AllocationRow[];
}

export interface ReturnsCalculatorOps {
  xirr(cashFlows: readonly CashFlow[]): Result<Percentage>;
  cagr(begin: Money, end: Money, years: string): Percentage;
  absoluteReturn(begin: Money, end: Money): Percentage;
}

export const CompliancePolicy: CompliancePolicyOps = {
  dueSnapshots: () => notImplemented('US-3.2', 'CompliancePolicy.dueSnapshots'),
  domesticSnapshotId: () => notImplemented('US-3.2', 'CompliancePolicy.domesticSnapshotId'),
  foreignSnapshotId: () => notImplemented('US-3.3', 'CompliancePolicy.foreignSnapshotId'),
};
export const SnapshotFactory: SnapshotFactoryOps = {
  build: () => notImplemented('US-3.1', 'SnapshotFactory.build'),
  assertImmutable: () => notImplemented('US-3.1', 'SnapshotFactory.assertImmutable'),
  verify: () => notImplemented('US-3.1', 'SnapshotFactory.verify'),
};
export const ContentHasher: ContentHasherOps = {
  hash: () => notImplemented('US-3.1', 'ContentHasher.hash'),
  canonicalJson: () => notImplemented('US-3.1', 'ContentHasher.canonicalJson'),
};
export const DeltaEngine: DeltaEngineOps = {
  compare: () => notImplemented('US-3.5', 'DeltaEngine.compare'),
};
export const AllocationShift: AllocationShiftOps = {
  compute: () => notImplemented('US-3.7', 'AllocationShift.compute'),
};
export const ReturnsCalculator: ReturnsCalculatorOps = {
  xirr: () => notImplemented('US-3.8', 'ReturnsCalculator.xirr'),
  cagr: () => notImplemented('US-3.8', 'ReturnsCalculator.cagr'),
  absoluteReturn: () => notImplemented('US-3.8', 'ReturnsCalculator.absoluteReturn'),
};
