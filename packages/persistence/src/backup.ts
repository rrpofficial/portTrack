/**
 * Backup and restore (US-8.8, PRD NFR-1).
 *
 * The archive carries BOTH the database and its KDF metadata. The salt lives
 * beside the database rather than inside it, so a backup of `vault.db` alone
 * restores to a vault nobody can open — the failure would surface only when the
 * user needs the backup most.
 */
import { Err, Ok, VaultStateError, type Result } from '@porttrack/shared-kernel';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Vault } from './vault.js';

const META_SUFFIX = '.meta.json';

export const Backup = {
  backup(destination: string): Promise<Result<string>> {
    const source = Vault.currentPaths();
    if (source === undefined) {
      return Promise.resolve(Err(new VaultStateError('no vault is open to back up')));
    }

    if (!existsSync(source.dbPath)) {
      // The database file is created when the vault is first unlocked. Backing
      // up before that is a caller mistake, not an I/O accident.
      return Promise.resolve(
        Err(new VaultStateError('vault has never been unlocked, so there is nothing to back up')),
      );
    }

    mkdirSync(dirname(destination), { recursive: true });
    const archive = {
      version: 1 as const,
      database: readFileSync(source.dbPath).toString('base64'),
      meta: readFileSync(source.metaPath, 'utf8'),
    };
    // The database is already encrypted at rest, so the archive inherits that
    // protection without a second key to manage.
    writeFileSync(destination, JSON.stringify(archive), { mode: 0o600 });
    return Promise.resolve(Ok(destination));
  },

  restore(source: string, destination: string): Promise<Result<void>> {
    if (!existsSync(source)) {
      return Promise.resolve(Err(new VaultStateError('backup archive was not found')));
    }
    const archive = JSON.parse(readFileSync(source, 'utf8')) as {
      version: number;
      database: string;
      meta: string;
    };

    mkdirSync(destination, { recursive: true });
    const dbPath = join(destination, 'vault.db');
    writeFileSync(dbPath, Buffer.from(archive.database, 'base64'), { mode: 0o600 });
    writeFileSync(`${dbPath}${META_SUFFIX}`, archive.meta, { mode: 0o600 });
    return Promise.resolve(Ok(undefined));
  },

  /** Copies a vault directory verbatim; used by the container upgrade path. */
  copyVault(fromDir: string, toDir: string): void {
    mkdirSync(toDir, { recursive: true });
    copyFileSync(join(fromDir, 'vault.db'), join(toDir, 'vault.db'));
    copyFileSync(join(fromDir, `vault.db${META_SUFFIX}`), join(toDir, `vault.db${META_SUFFIX}`));
  },
};
