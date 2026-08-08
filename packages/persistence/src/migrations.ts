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
  {
    version: 2,
    name: 'asset-round-trip',
    up: `
      -- v1 could store an Asset only partially: income events, corporate actions
      -- and hand-loan repayments had nowhere to go, so saving a holding and
      -- reading it back silently dropped its dividends and its splits. A ledger
      -- that loses income events understates taxable income, which is the exact
      -- failure this product exists to prevent.
      CREATE TABLE income_events (
        event_id              TEXT PRIMARY KEY,
        asset_id              TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        kind                  TEXT NOT NULL,
        date                  TEXT NOT NULL,
        gross_amount          TEXT NOT NULL,
        tax_withheld          TEXT NOT NULL,
        net_amount            TEXT NOT NULL,
        currency              TEXT NOT NULL,
        withholding_rate_pct  TEXT,
        eligible_for_ftc      INTEGER NOT NULL DEFAULT 0,
        taxable_inr           TEXT
      );
      CREATE INDEX idx_income_events_asset ON income_events(asset_id);

      CREATE TABLE corporate_actions (
        action_id   TEXT PRIMARY KEY,
        asset_id    TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        record_date TEXT NOT NULL,
        ratio_from  TEXT NOT NULL,
        ratio_to    TEXT NOT NULL
      );
      CREATE INDEX idx_corporate_actions_asset ON corporate_actions(asset_id);

      CREATE TABLE hand_loan_repayments (
        repayment_id TEXT PRIMARY KEY,
        asset_id     TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        date         TEXT NOT NULL,
        principal    TEXT NOT NULL,
        currency     TEXT NOT NULL
      );
      CREATE INDEX idx_hand_loan_repayments_asset ON hand_loan_repayments(asset_id);

      -- A mutual fund's tax character is DERIVED from these two (ADR-016); losing
      -- them on a round trip would silently reclassify an equity-oriented fund.
      ALTER TABLE assets ADD COLUMN scheme_category TEXT;
      ALTER TABLE assets ADD COLUMN equity_allocation_pct TEXT;

      -- v1 had a single rate_source column but DualRate carries two independent
      -- rates with independent provenance (ADR-003). One column cannot record
      -- that a valuation rate was authoritative while the tax rate was a fallback.
      ALTER TABLE lots ADD COLUMN tax_rate_source TEXT;
      ALTER TABLE lots ADD COLUMN fx_is_fallback INTEGER;
      ALTER TABLE lots ADD COLUMN fx_fallback_note TEXT;
    `,
  },
  {
    version: 3,
    name: 'exits',
    up: `
      -- A disposal left no trace: lots recorded that quantity had gone, but not
      -- that a SELL caused it. Two consequences, both bad. Re-importing an
      -- overlapping statement re-applied every sell, depleting holdings twice,
      -- because a sell could not be recognised as one already seen. And realised
      -- gains had no source record to compute from.
      CREATE TABLE exits (
        txn_id           TEXT PRIMARY KEY,
        asset_id         TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        exit_date        TEXT NOT NULL,
        acquisition_date TEXT,
        quantity         TEXT NOT NULL,
        price_per_unit   TEXT NOT NULL,
        currency         TEXT NOT NULL,
        fees             TEXT NOT NULL DEFAULT '0',
        stt              TEXT NOT NULL DEFAULT '0',
        -- The lot breakdown is a value object of the exit and is never queried
        -- independently, so it is stored whole rather than in a child table.
        allocations      TEXT NOT NULL,
        valuation_rate   TEXT,
        tax_rate         TEXT,
        rate_source      TEXT,
        tax_rate_source  TEXT,
        fx_is_fallback   INTEGER,
        fx_fallback_note TEXT,
        valuation_inr    TEXT,
        taxable_inr      TEXT
      );
      CREATE INDEX idx_exits_asset ON exits(asset_id);
      CREATE INDEX idx_exits_date ON exits(exit_date);
    `,
  },
  {
    version: 4,
    name: 'settings',
    up: `
      -- Small, singular application state that is not ledger data: the income
      -- profile behind an advance-tax figure, for one. Held in the encrypted
      -- vault like everything else — salary is exactly as sensitive as holdings.
      -- Previously this lived in a module-level variable and was lost on every
      -- restart, so a computed tax figure silently reverted to "zero income".
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
