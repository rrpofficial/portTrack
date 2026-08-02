/**
 * Forward-only, idempotent schema migrations (US-8.3).
 *
 * Money columns are stored as `TEXT` decimal strings, never REAL — a float column
 * would reintroduce exactly the drift ADR-002 exists to prevent.
 */
import type { Database } from 'better-sqlite3-multiple-ciphers';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-ledger',
    up: `
      CREATE TABLE assets (
        asset_id      TEXT PRIMARY KEY,
        asset_class   TEXT NOT NULL,
        jurisdiction  TEXT NOT NULL CHECK (jurisdiction IN ('DOMESTIC','FOREIGN')),
        currency      TEXT NOT NULL,
        symbol        TEXT,
        isin          TEXT,
        folio_ref     TEXT,
        liquidity     TEXT,
        position_closed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE lots (
        lot_id             TEXT PRIMARY KEY,
        asset_id           TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        acquisition_date   TEXT NOT NULL,
        settlement_date    TEXT NOT NULL,
        quantity           TEXT NOT NULL,
        remaining_quantity TEXT NOT NULL,
        cost_per_unit      TEXT NOT NULL,
        cost_currency      TEXT NOT NULL,
        fees               TEXT NOT NULL DEFAULT '0',
        stt                TEXT NOT NULL DEFAULT '0',
        other_charges      TEXT NOT NULL DEFAULT '0',
        valuation_rate     TEXT,
        tax_rate           TEXT,
        rate_source        TEXT,
        grandfathered_fmv  TEXT,
        perquisite_value   TEXT,
        is_bonus           INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_lots_asset ON lots(asset_id);
      CREATE INDEX idx_lots_acquisition ON lots(acquisition_date);

      CREATE TABLE liabilities (
        liability_id         TEXT PRIMARY KEY,
        kind                 TEXT NOT NULL,
        principal_outstanding TEXT NOT NULL,
        currency             TEXT NOT NULL,
        interest_rate_pct    TEXT NOT NULL,
        as_of                TEXT NOT NULL
      );

      CREATE TABLE hand_loans (
        asset_id          TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
        borrower_ref      TEXT NOT NULL,
        principal         TEXT NOT NULL,
        currency          TEXT NOT NULL,
        interest_rate_pct TEXT NOT NULL,
        interest_basis    TEXT NOT NULL CHECK (interest_basis IN ('SIMPLE','COMPOUND')),
        start_date        TEXT NOT NULL
      );

      CREATE TABLE snapshots (
        snapshot_id  TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        scope        TEXT NOT NULL,
        as_of        TEXT NOT NULL,
        payload      TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_snapshots_as_of ON snapshots(as_of);
    `,
  },
];

const SCHEMA_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export function currentVersion(db: Database): number {
  db.exec(SCHEMA_TABLE);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

/** Applies every migration above the current version. Idempotent. */
export function runMigrations(db: Database, appliedAt: string): number {
  db.exec(SCHEMA_TABLE);
  let version = currentVersion(db);

  const record = db.prepare(
    'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    // Each migration is its own transaction: a failure leaves the previous
    // version intact rather than a half-applied schema.
    db.transaction(() => {
      db.exec(migration.up);
      record.run(migration.version, migration.name, appliedAt);
    })();
    version = migration.version;
  }

  return version;
}
