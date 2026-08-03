/**
 * persistence — encrypted SQLite vault on the HOST bind mount (ADR-012),
 * page-level AES-256-CBC + HMAC-SHA512 whole-file encryption (ADR-015),
 * forward-only migrations, repositories.
 */
import { notImplemented, type Result } from '@porttrack/shared-kernel';
import type { Asset, Liability } from '@porttrack/core-domain';
import type { Snapshot } from '@porttrack/snapshot';
import { Vault } from './vault.js';
import { currentVersion, runMigrations } from './migrations.js';
import { deriveKey, zeroise } from './crypto.js';
export { SnapshotRepository } from './snapshot-repository.js';
export { Backup } from './backup.js';

export { Vault } from './vault.js';
export type { VaultConfig, VaultHandle } from './vault.js';
export { MIGRATIONS } from './migrations.js';

/** Key derivation and zeroisation for the vault (ADR-014). */
export const CryptoEnvelope = {
  deriveKey: (passphrase: string, salt: Uint8Array): Promise<Uint8Array> =>
    Promise.resolve(deriveKey(passphrase, salt)),
  zeroise,
};

export const MigrationRunner = {
  run: (): Promise<Result<number>> =>
    Promise.resolve({ ok: true, value: runMigrations(Vault.connection(), new Date().toISOString()) }),
  currentVersion: (): Promise<number> => Promise.resolve(currentVersion(Vault.connection())),
};

/* ------------------------------------------------- not yet implemented (M2) */

export interface AssetRepositoryOps {
  save(asset: Asset): Promise<Result<void>>;
  findById(assetId: string): Promise<Asset | undefined>;
  all(): Promise<readonly Asset[]>;
}

export interface LiabilityRepositoryOps {
  save(liability: Liability): Promise<Result<void>>;
  all(): Promise<readonly Liability[]>;
}

export interface SnapshotRepositoryOps {
  /** Write-once. Re-persisting an existing id with a different hash is an error. */
  persistImmutable(snapshot: Snapshot): Promise<Result<void>>;
  findById(snapshotId: string): Promise<Snapshot | undefined>;
  exists(snapshotId: string): Promise<boolean>;
  listIds(): Promise<readonly string[]>;
}

export interface BackupOps {
  backup(destination: string): Promise<Result<string>>;
  restore(source: string, destination: string): Promise<Result<void>>;
}

export const AssetRepository: AssetRepositoryOps = {
  save: () => notImplemented('US-8.3', 'AssetRepository.save'),
  findById: () => notImplemented('US-8.3', 'AssetRepository.findById'),
  all: () => notImplemented('US-8.3', 'AssetRepository.all'),
};
export const LiabilityRepository: LiabilityRepositoryOps = {
  save: () => notImplemented('US-8.3', 'LiabilityRepository.save'),
  all: () => notImplemented('US-8.3', 'LiabilityRepository.all'),
};
