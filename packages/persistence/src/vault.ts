/**
 * The encrypted vault (US-8.2, ADR-012, ADR-015).
 *
 * Page-level AES-256-CBC + HMAC-SHA512 over the whole database file, so schema
 * identifiers and index structures are encrypted alongside the values.
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 *  1. Opening a tampered database SUCCEEDS. A byte flipped deep in the file is not
 *     detected by reading `sqlite_schema` — it is only caught by a check that walks
 *     every page. `unlock` therefore runs `quick_check`, and a vault that fails it
 *     is refused. Without this, silent corruption reads back as valid data.
 *  2. The KDF salt is stored in plaintext beside the database. That is by design —
 *     a salt is not secret — but it means the salt file must travel with the vault,
 *     so backup and restore cover both.
 */
import Database from 'better-sqlite3-multiple-ciphers';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Err,
  Ok,
  VaultStateError,
  VaultUnlockError,
  type Result,
} from '@porttrack/shared-kernel';
import {
  KDF_PARAMS,
  deriveKeyAsync,
  newSalt,
  toHex,
  zeroise,
  type KdfParams,
} from './crypto.js';
import { runMigrations } from './migrations.js';

/** SQLite3MultipleCiphers scheme name for AES-256-CBC + HMAC-SHA512. */
const CIPHER_SCHEME = 'sqlcipher';
const META_FILE_SUFFIX = '.meta.json';

export interface VaultConfig {
  /** In-container path backed by the host bind mount (ADR-012). */
  readonly dataDir: string;
  readonly fileName: string;
}

export interface VaultHandle {
  readonly schemaVersion: number;
  readonly locked: boolean;
}

interface VaultMeta {
  readonly version: 1;
  readonly cipher: string;
  readonly kdf: 'argon2id';
  readonly saltHex: string;
  readonly params: KdfParams;
}

interface OpenState {
  config: VaultConfig;
  dbPath: string;
  metaPath: string;
  meta: VaultMeta;
  db?: Database.Database | undefined;
  key?: Uint8Array | undefined;
}

let state: OpenState | undefined;

function readOrCreateMeta(metaPath: string): VaultMeta {
  if (existsSync(metaPath)) {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as VaultMeta;
  }
  const meta: VaultMeta = {
    version: 1,
    cipher: CIPHER_SCHEME,
    kdf: 'argon2id',
    saltHex: toHex(newSalt()),
    params: KDF_PARAMS,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
  return meta;
}

export const Vault = {
  open(config: VaultConfig): Promise<Result<VaultHandle>> {
    mkdirSync(config.dataDir, { recursive: true });
    const dbPath = join(config.dataDir, config.fileName);

    // Re-opening the same vault is a no-op. Resetting state here would lock an
    // already-unlocked session merely because another handle was constructed.
    if (state?.dbPath === dbPath && state.db !== undefined) {
      return Promise.resolve(Ok({ schemaVersion: 1, locked: false }));
    }

    const metaPath = `${dbPath}${META_FILE_SUFFIX}`;
    state = { config, dbPath, metaPath, meta: readOrCreateMeta(metaPath) };
    return Promise.resolve(Ok({ schemaVersion: 0, locked: true }));
  },

  async unlock(passphrase: string): Promise<Result<VaultHandle>> {
    if (!state) {
      return Err(new VaultStateError('vault is not open'));
    }
    const current = state;

    /*
     * An empty passphrase is refused outright. On a BRAND-NEW vault there is no
     * stored key to check against, so the first unlock silently becomes the one
     * that sets it — meaning an empty string would quietly create a vault that
     * anyone can open, and it would look like a successful unlock.
     */
    if (passphrase.length === 0) {
      return Err(new VaultUnlockError('a vault passphrase is required and cannot be empty'));
    }

    /*
     * Derived on a worker thread. Argon2id at the OWASP baseline occupies a core
     * for ~350 ms, and doing that on the main thread froze the entire API for the
     * duration — health probes included — so concurrent unlocks serialized and
     * the UI looked hung. See crypto.ts.
     */
    const key = await deriveKeyAsync(
      passphrase,
      Buffer.from(current.meta.saltHex, 'hex'),
      current.meta.params,
    );
    let db: Database.Database | undefined;

    try {
      db = new Database(current.dbPath);
      db.pragma(`cipher='${current.meta.cipher}'`);
      db.pragma(`hexkey='${toHex(key)}'`);

      // Walks every page. A wrong key fails here; so does a tampered file, which a
      // schema read alone would not catch.
      const check = db.pragma('quick_check', { simple: true });
      if (check !== 'ok') {
        throw new Error(`integrity check returned ${String(check)}`);
      }

      db.pragma('journal_mode=WAL');
      db.pragma('synchronous=FULL');
      db.pragma('foreign_keys=ON');

      const schemaVersion = runMigrations(db, new Date().toISOString());

      current.db = db;
      current.key = key;
      return Ok({ schemaVersion, locked: false });
    } catch {
      db?.close();
      zeroise(key);
      // Deliberately uninformative: the message must not reveal whether the vault
      // holds data, nor echo the attempted passphrase.
      return Err(new VaultUnlockError('unable to unlock vault: wrong passphrase or corrupted data'));
    }
  },

  lock(): Promise<void> {
    if (!state) return Promise.resolve();
    state.db?.close();
    state.db = undefined;
    if (state.key) {
      zeroise(state.key);
      state.key = undefined;
    }
    return Promise.resolve();
  },

  async close(): Promise<void> {
    await Vault.lock();
    state = undefined;
  },

  /** Throws unless the vault is unlocked. Repositories depend on this. */
  connection(): Database.Database {
    if (!state?.db) throw new VaultStateError('vault is locked');
    return state.db;
  },

  isUnlocked(): boolean {
    return Boolean(state?.db);
  },

  /** Paths of the open vault, so backup can archive the salt alongside it. */
  currentPaths(): { dbPath: string; metaPath: string } | undefined {
    return state === undefined ? undefined : { dbPath: state.dbPath, metaPath: state.metaPath };
  },
};
