/**
 * Error taxonomy. Two rules hold everywhere (DoD D6, D7):
 *  - expected domain failures are returned as `Result`, never thrown;
 *  - no error message, `cause` chain or field ever carries a PII value.
 */

export class NotImplementedError extends Error {
  constructor(
    public readonly storyId: string,
    symbol: string,
  ) {
    super(`${symbol} is not implemented yet (${storyId})`);
    this.name = 'NotImplementedError';
  }
}

export function notImplemented(storyId: string, symbol: string): never {
  throw new NotImplementedError(storyId, symbol);
}

/** Base class for failures the caller is expected to handle. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidAmountError extends DomainError {
  readonly code = 'INVALID_AMOUNT';
}
export class InvalidQuantityError extends DomainError {
  readonly code = 'INVALID_QUANTITY';
}
export class InsufficientQuantityError extends DomainError {
  readonly code = 'INSUFFICIENT_QUANTITY';
}
export class UnsupportedAssetClassError extends DomainError {
  readonly code = 'UNSUPPORTED_ASSET_CLASS';
}
export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
}
export class InvalidDateError extends DomainError {
  readonly code = 'INVALID_DATE';
}
export class RateUnavailableError extends DomainError {
  readonly code = 'RATE_UNAVAILABLE';
}
export class RateConflictError extends DomainError {
  readonly code = 'RATE_CONFLICT';
}
export class SnapshotImmutableError extends DomainError {
  readonly code = 'SNAPSHOT_IMMUTABLE';
}
export class SnapshotDivergenceError extends DomainError {
  readonly code = 'SNAPSHOT_DIVERGENCE';
}
export class FutureSnapshotError extends DomainError {
  readonly code = 'FUTURE_SNAPSHOT';
}
export class XirrNonConvergenceError extends DomainError {
  readonly code = 'XIRR_NON_CONVERGENCE';
}
export class TaxRulesUnavailableError extends DomainError {
  readonly code = 'TAX_RULES_UNAVAILABLE';
}
export class TemplateHeaderMismatchError extends DomainError {
  readonly code = 'TEMPLATE_HEADER_MISMATCH';
  constructor(
    message: string,
    readonly missing: readonly string[] = [],
    readonly unexpected: readonly string[] = [],
  ) {
    super(message);
  }
}
export class PdfDecryptionError extends DomainError {
  readonly code = 'PDF_DECRYPTION_FAILED';
}
export class UnknownCasLayoutError extends DomainError {
  readonly code = 'UNKNOWN_CAS_LAYOUT';
}
export class PiiLeakError extends DomainError {
  readonly code = 'PII_LEAK';
  constructor(
    message: string,
    /** Category of the offending entity. NEVER the entity value itself. */
    readonly entityKind: string,
  ) {
    super(message);
  }
}
export class VaultUnlockError extends DomainError {
  readonly code = 'VAULT_UNLOCK_FAILED';
}
export class VaultStateError extends DomainError {
  readonly code = 'VAULT_STATE';
}
export class MigrationError extends DomainError {
  readonly code = 'MIGRATION_FAILED';
}
export class EgressDeniedError extends DomainError {
  readonly code = 'EGRESS_DENIED';
}
