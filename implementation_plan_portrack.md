# portTrack — Implementation Plan

**Project:** portTrack — Global Portfolio Tracking & Indian Tax Compliance Platform
**Source of truth:** [`Global_Portfolio_Tracker_PRD.md`](./Global_Portfolio_Tracker_PRD.md)
**Plan version:** 1.0
**Date:** 2026-08-02
**Status:** Approved for execution

---

## 0. Critical Decisions & PRD Conflict Resolutions (READ FIRST)

These are structural decisions that change the data model. Each is recorded as an ADR and is
reversible only at material cost after Milestone M2.

| ADR | Decision | Rationale | Reversibility |
|-----|----------|-----------|---------------|
| **ADR-001** | **TypeScript monorepo**, pnpm workspaces. Pure-TS domain packages with zero I/O; adapters at the edge. | PRD §4.3 mandates local-first + PII masking in "WebAssembly/Node edge runtime". One language end-to-end keeps the masker identical on client and CLI. | High cost after M1 |
| **ADR-002** | **All money is `Decimal` (decimal.js), never `number`.** Persisted as a `{ amount: string, currency: ISO4217 }` pair. Rounding policy is explicit per call site. | IEEE-754 drift is unacceptable in a tax filing artifact. ₹1.25L LTCG exemption boundaries and surcharge cliffs are exact-comparison problems. | Very high after M1 |
| **ADR-003** | **Dual FX rate per foreign transaction.** `valuationRate` = trade-date ITBR (portfolio display, NAV, net worth). `taxRate` = Rule 115 rate (last day of month preceding the transaction month) used for *all* taxable-income computation. | **Resolves PRD conflict:** FR-1 AC demands trade-date conversion; FR-2.1 demands Rule 115. They govern different outputs, not the same output. Storing one rate makes the other unrecoverable. | Medium |
| **ADR-004** | **HNI = `totalIncome > ₹50L` OR `netWorth > ₹10 Cr`** (FR-5.1 is normative). | **Resolves PRD conflict:** §2.1 persona text says "Portfolio > ₹1 Crore" — that is descriptive prose, FR-5.1 is the requirement. Thresholds live in a versioned rule table, never inlined. | Low (config) |
| **ADR-005** | **Tax rules are data, keyed by Financial Year**, loaded from `packages/tax-engine/rules/FY-YYYY-YY.json`. No rate literal appears in engine code. | Indian slab/surcharge/CG rates changed materially in FY 2024-25 and will change again. A hardcoded 12.5% is a defect the day the Finance Act passes. | Low |
| **ADR-006** | **Snapshots are immutable and content-addressed** (SHA-256 over canonical JSON). Recomputation that yields a different hash raises, it does not overwrite. | PRD FR-3.1 says "freeze"; a compliance artifact that silently mutates is worse than no artifact. | Medium |
| **ADR-007** | **PII masking is fail-closed.** The egress guard re-scans the *post-mask* payload; any residual PAN/Aadhaar/email pattern throws `PiiLeakError` and the AI call is aborted. Masking is never "best effort". | FR-7.2 says "no PII entity shall leak". A warn-and-continue masker satisfies the letter and violates the intent. | Low |
| **ADR-008** | **All EOD boundaries resolve in `Asia/Kolkata`.** "31-Mar EOD" means `2026-03-31T23:59:59.999+05:30`. Foreign 31-Dec snapshots also freeze at IST EOD. | Ambiguous EOD makes 31-Mar and 1-Apr snapshots non-deterministic across machines. | Low |
| **ADR-009** | **Liabilities are first-class ledger entities**, not negative assets. | Schedule AL (FR-6.2) requires liabilities reported separately at closing balance. Modelling them as negative assets loses the distinction. | Medium |
| **ADR-010** | **Zero network egress by default.** FX scraping, price refresh and AI calls are explicitly user-triggered and pass through a single audited `EgressGateway`. | PRD §4.3 data sovereignty. Also makes the whole test suite hermetic. | Low |
| **ADR-011** | **Two-container split: `porttrack-api` (Node 22) + `porttrack-web` (SPA behind Caddy/nginx).** Domain packages compile into the API image; the SPA is a static build reverse-proxying `/api`. | PRD FR-8.1 requires frontend and backend to be separately containerized. Keeping the domain in one process preserves the sub-1.5s valuation budget (no cross-service chatter). | High after M1 |
| **ADR-012** | **DB on a host **bind mount**, never a named/anonymous Docker volume.** Host path `${PORTTRACK_DATA_DIR:-./data}` → `/var/lib/porttrack` in-container. Containers run as `${PORTTRACK_UID}:${PORTTRACK_GID}`. | PRD FR-8.2 says "native OS disk volume" — a named volume lives in Docker's own storage area and is not directly accessible or backup-able from the host. Bind mount is the only option that satisfies "visible and copyable from the host". | Low |
| **ADR-013** | **PII masking stays in the browser bundle**, not the API container. The API never receives unmasked text destined for an AI service. | FR-7.1 says masking is client-side. Containerizing must not quietly turn the masker into a server-side step — that would put unmasked PII on the wire, defeating the requirement. `pii-masker` is a pure package imported by the SPA; the API imports only its *verifier* for the fail-closed guard. | Medium |
| **ADR-014** | **The vault passphrase never reaches the API container's disk.** It is supplied per-session, held in memory only, and the derived key is zeroised on lock/shutdown. | FR-8.3 "no secrets in images"; also prevents a bind-mounted `.env` from becoming the weakest link. | Low |
| **ADR-015** | **Vault encryption is page-level whole-file AES-256-CBC + HMAC-SHA512** (the `sqlcipher` scheme in `better-sqlite3-multiple-ciphers`), **not AES-256-GCM.** NFR-1 amended accordingly. | **AES-256-GCM is not offered by any whole-file SQLite encryption provider** — the available schemes are `aes128cbc`, `aes256cbc`, `chacha20`, `sqlcipher`, `rc4`, `ascon128`, `aegis` (empirically enumerated, see below). Application-layer value encryption *can* use GCM but would forfeit range queries and indexing on the date and amount columns the ledger and snapshot engines depend on, for no material gain over one authenticated layer. `aes256cbc` alone was ruled out: it is unauthenticated and silently returns data from a tampered file. | Medium |

#### ADR-015 evidence

Measured on `better-sqlite3-multiple-ciphers@12.11.1` (SQLite 3.53.2) on 2026-08-02, by writing a table
named `hand_loans_ledger` containing a PAN-shaped value, closing the database, then inspecting the raw
file, reopening with a wrong key, and flipping one byte at 60% depth before reopening with the right key:

| scheme | schema identifiers hidden | values hidden | plaintext `SQLite format 3` header | wrong key rejected | tamper detected |
|---|---|---|---|---|---|
| `chacha20` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **`sqlcipher`** ← chosen | ✅ | ✅ | ✅ | ✅ | ✅ |
| `aes256cbc` | ✅ | ✅ | ✅ | ✅ | ❌ **returns tampered data** |
| `aegis` | ✅ | ✅ | ✅ | ✅ | ✅ |

`aes256cbc` is unauthenticated and therefore disqualified regardless of its name matching NFR-1's
original wording. `sqlcipher` was chosen over `chacha20` because it retains AES-256 (minimising the PRD
amendment) and is the most widely audited of the authenticated options. The regression test for the
bottom row lives in `packages/persistence/test/vault-encryption.spec.ts`.

### Open questions requiring user input before the milestone noted

| # | Question | Blocks | Working assumption until answered |
|---|----------|--------|-----------------------------------|
| OQ-1 | Live market price source for domestic equities/MF NAV (paid API vs manual vs AMFI NAVAll.txt)? | M4 | AMFI `NAVAll.txt` for MF NAV; manual price entry for equities; adapter interface stubbed so any source drops in. |
| OQ-2 | Is multi-user / family-member portfolio segregation in scope? | M2 | Single `userId` per encrypted vault; schema carries `userId` FK so multi-profile is additive. |
| OQ-3 | Does the user want DTAA foreign tax credit (Form 67) computed, or only recorded? | M5 | Computed as relief in the tax summary, but **not** exported as Form 67; recorded with treaty rate provenance. |
| OQ-4 | Grandfathering (31-Jan-2018 FMV) — is a historical FMV dataset available, or manual entry? | M5 | Manual per-lot `grandfatheredFmv` field, engine applies the higher-of rule when present. |

---

## 1. Architecture Summary

Full component and sequence diagrams: **[`ARCHITECTURE_portrack.md`](./ARCHITECTURE_portrack.md)**.

Layering rule enforced by lint (`import/no-restricted-paths`):

```
apps/api, apps/cli  ──▶  packages/app-services  ──▶  packages/<domain>  ──▶  packages/shared-kernel
                                  │
                                  └──▶  packages/persistence, packages/adapters-*   (I/O only)

apps/web  ──▶  HTTP (/api)  ──▶  apps/api          # no domain package bundled into the SPA…
apps/web  ──▶  packages/pii-masker                 # …except the masker, which MUST be client-side (ADR-013)
```

Domain packages (`core-domain`, `fx-itbr`, `tax-engine`, `snapshot`, `pii-masker`) are **pure**: no
`fs`, no `fetch`, no `Date.now()`. Time and randomness are injected via a `Clock` and `IdGenerator`
port. This is what makes the tax engine deterministically testable across FYs — and what lets the same
`pii-masker` code run in the browser bundle and in the API's fail-closed verifier.

### Repository layout

```
portTrack/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json              # strict: true, noUncheckedIndexedAccess: true
├── vitest.workspace.ts
├── playwright.config.ts
├── implementation_plan_portrack.md
├── ARCHITECTURE_portrack.md
├── Global_Portfolio_Tracker_PRD.md
├── packages/
│   ├── shared-kernel/              # Money, Decimal, FyDate, Result, ids, Clock port
│   ├── core-domain/                # Asset, Lot, Transaction, Liability, FIFO, valuation
│   ├── fx-itbr/                    # RateStore, Rule115Resolver, FallbackChain, dual-rate service
│   ├── tax-engine/                 # slabs, surcharge, marginal relief, cess, CG, advance tax
│   │   └── rules/FY-2025-26.json   # ADR-005 rule data
│   ├── snapshot/                   # immutable snapshot, scheduler policy, delta/variance, XIRR
│   ├── ingestion/                  # pipeline + CAMS/Zerodha/Vested/E*TRADE/template parsers
│   ├── compliance/                 # Schedule FA (A3, D) + Schedule AL generators
│   ├── pii-masker/                 # regex rules, NER, pseudonymizer, egress guard
│   ├── persistence/                # SQLite (page-level AES-256), migrations, repositories
│   ├── adapters-fx/                # SBI/RBI/ECB HTTP scrapers (I/O)
│   └── app-services/               # use-case orchestration consumed by apps
├── apps/
│   ├── api/                        # Fastify backend service  → image porttrack-api
│   ├── web/                        # React + Vite SPA          → image porttrack-web
│   └── cli/                        # headless snapshot / tax / import runner
├── docker/
│   ├── api.Dockerfile              # multi-stage, non-root, minimal runtime
│   ├── web.Dockerfile              # build stage + Caddy static server
│   ├── Caddyfile                   # SPA fallback + /api reverse proxy
│   └── entrypoint-api.sh           # data-dir perms check → migrations → exec node
├── compose.yaml                    # base stack (default profile, egress denied)
├── compose.override.yaml           # local dev: HMR + source bind mounts
├── compose.egress.yaml             # opt-in profile enabling outbound FX/AI network
├── .env.example                    # PORTTRACK_DATA_DIR, PORTTRACK_UID/GID, ports
└── tests/
    ├── functional/                 # cross-package acceptance tests (Vitest)
    ├── container/                  # Docker acceptance tests (compose up/down, persistence)
    ├── e2e/                        # Playwright UI journeys (run against the containerized stack)
    └── fixtures/                   # synthetic CAS/Zerodha/Vested/E*TRADE files, rate sheets
```

### Container topology (PRD FR-8)

```
host:${PORTTRACK_WEB_PORT:-5173}
      │
      ▼
  porttrack-web   Caddy + SPA bundle (includes pii-masker — ADR-013)   non-root · read-only FS
      │  /api/*  reverse-proxied over the internal bridge network
      ▼
  porttrack-api   Node 22 + Fastify + all domain packages              non-root · read-only FS
      │  better-sqlite3
      ▼
  /var/lib/porttrack/vault.db
      ▲
      └── bind mount ──▶  ${PORTTRACK_DATA_DIR:-./data}  ON THE HOST'S NATIVE DISK   (ADR-012)
```

Only `porttrack-web` publishes a host port; `porttrack-api` is reachable solely on the internal bridge
network. Neither container has outbound internet access unless the user explicitly starts the `egress`
profile (ADR-010). Writable paths in `porttrack-api` are exactly two: the bind-mounted data directory and
a `tmpfs` `/tmp`.

### Technology decisions

| Concern | Choice | Note |
|---|---|---|
| Language / runtime | TypeScript 5.6 (strict), Node 22 | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on |
| Money | `decimal.js` wrapped in `Money` VO | ADR-002; no raw `number` arithmetic on currency |
| Dates | `@internationalized/date` / native `Temporal`-shim, IST-fixed | ADR-008 |
| Persistence | `better-sqlite3-multiple-ciphers`, `sqlcipher` scheme | ADR-015. Page-level AES-256-CBC + HMAC-SHA512 over the whole file; key = Argon2id(passphrase, salt), memory-only |
| PDF (CAMS CAS) | `mupdf-js` / `pdf-lib` + `qpdf`-wasm for decryption | Password in-memory only, zeroised after parse |
| XLSX / CSV | `exceljs`, `papaparse` | Streamed, row-level error collection |
| NER (names) | `wink-nlp` (local, no network) | FR-7.2 name masking |
| UI | React 18 + Vite + TanStack Query/Table | |
| Unit tests | **Vitest** | Domain packages, ≥90% line / ≥85% branch |
| Functional tests | **Vitest** (`tests/functional`) | Full use-case wiring against in-memory + temp-file SQLite |
| E2E tests | **Playwright** | User journeys through the real UI |
| Backend service | Fastify 5 on Node 22 | `apps/api`; thin HTTP shell over `app-services` |
| Static serving | Caddy 2 (alpine) | SPA fallback + `/api` reverse proxy; auto-compresses |
| Containers | Docker + Compose v2 | Two images, pinned base digests, non-root, read-only FS |
| DB location | Host bind mount `${PORTTRACK_DATA_DIR:-./data}` | ADR-012 — native host disk, not a Docker volume |
| Container tests | Vitest + `testcontainers` / raw `docker compose` | `tests/container/`, tagged so they can be excluded from the fast unit run |
| Lint/format | ESLint (typescript-eslint strict) + Prettier | Layering rules enforced |

---

## 2. Domain Model (canonical)

```ts
type AssetClass =
  | 'DOMESTIC_EQUITY' | 'DOMESTIC_ETF' | 'DOMESTIC_MUTUAL_FUND'
  | 'FOREIGN_EQUITY'  | 'FOREIGN_ETF'  | 'RSU' | 'ESPP'
  | 'EPF' | 'VPF' | 'NPS_TIER_I' | 'NPS_TIER_II' | 'PPF' | 'GRATUITY'
  | 'FIXED_DEPOSIT' | 'RECURRING_DEPOSIT'
  | 'REAL_ESTATE' | 'UNLISTED_SHARES' | 'CRYPTO' | 'GOLD_PHYSICAL' | 'GOLD_DIGITAL' | 'SGB'
  | 'CASH_IN_HAND' | 'BANK_BALANCE' | 'HAND_LOAN' | 'CHIT_FUND';

interface Asset {
  assetId: AssetId;            // 'ast_<class>_<nanoid>'
  assetClass: AssetClass;
  jurisdiction: 'DOMESTIC' | 'FOREIGN';   // drives 31-Mar vs 31-Dec snapshot membership
  symbol?: string; isin?: string; folioNo?: PiiRef;
  currency: Currency;
  lots: AcquisitionLot[];
  incomeEvents: IncomeEvent[];            // dividend / interest / accrual
  corporateActions: CorporateAction[];
}

interface AcquisitionLot {
  lotId: LotId;
  acquisitionDate: IsoDate; settlementDate?: IsoDate;
  quantity: Decimal; remainingQuantity: Decimal;
  costPerUnit: Money;                     // native currency
  fees: Money; stt: Money; otherCharges: Money;
  fx?: { valuationRate: Decimal; taxRate: Decimal; source: RateSource };  // ADR-003
  grandfatheredFmv?: Money;               // 31-Jan-2018 FMV, OQ-4
}

interface ExitTransaction {
  txnId: TxnId; assetId: AssetId;
  exitDate: IsoDate; quantity: Decimal; pricePerUnit: Money;
  fees: Money; stt: Money;
  allocations: LotAllocation[];           // FIFO output, immutable once committed
  fx?: { valuationRate: Decimal; taxRate: Decimal; source: RateSource };
}

interface Liability {                     // ADR-009
  liabilityId: LiabilityId;
  kind: 'HOME_LOAN' | 'PERSONAL_LOAN' | 'MORTGAGE' | 'OTHER';
  principalOutstanding: Money; interestRatePct: Decimal; asOf: IsoDate;
}

interface Snapshot {                      // ADR-006, immutable
  snapshotId: string;                     // 'DOM_31MAR2026' | 'FOR_31DEC2026' | 'CUSTOM_<date>'
  kind: 'DOMESTIC_COMPLIANCE' | 'FOREIGN_COMPLIANCE' | 'CUSTOM';
  asOf: IsoDateTime;                      // IST EOD
  scope: 'DOMESTIC' | 'FOREIGN' | 'ALL';
  positions: SnapshotPosition[];
  totals: { netWorth: Money; byAssetClass: Record<AssetClass, Money>; liabilities: Money };
  contentHash: string; createdAt: IsoDateTime; frozen: true;
}
```

---

## 3. Global Definition of Ready (DoR)

A story may enter development only when **all** hold:

1. Acceptance criteria written as executable Gherkin, traceable to a PRD FR-ID.
2. Every input/output type named in the domain model or added to it in the same PR.
3. External data dependencies have a committed fixture in `tests/fixtures/` (no live network in tests).
4. Rounding, currency and timezone behaviour explicitly stated where money or dates are involved.
5. Story is estimated and its blocking dependencies are `Done`.

## 4. Global Definition of Done (DoD)

A story is `Done` only when **all** hold. No partial credit.

| # | Criterion |
|---|-----------|
| D1 | Every Gherkin AC in the story has a passing automated test, named after the scenario. |
| D2 | Unit coverage on touched domain package ≥ 90% lines / ≥ 85% branches; no `istanbul ignore` without a comment justifying it. |
| D3 | Functional test exercises the story through `app-services` (not the internals) with a real repository. |
| D4 | TypeScript strict passes; **zero** `any`, `as unknown as`, or non-null `!` assertions in the diff. |
| D5 | No money arithmetic on `number`; all money crosses boundaries as `Money`. |
| D6 | Error paths are explicit: expected failures return `Result<T, DomainError>`; unexpected ones throw typed errors. No empty `catch`. |
| D7 | No PII in logs, error messages, or thrown-error payloads (asserted by a shared `expectNoPii()` helper). |
| D8 | Applicable NFR budget verified by benchmark test (valuation < 1.5 s @ 1,000 lots; snapshot delta < 2.0 s). |
| D9 | If tax/FX/compliance logic: a worked numeric example is in the package README, and its numbers are the test's expected values. |
| D10 | Public API of the package is documented via TSDoc on exported symbols only. |
| D11 | Tracker row (§7) updated; PRD FR-ID traceability link present in the PR description. |
| D12 | Lint + typecheck + full test suite green in CI on the branch. |
| D13 | If the story changes runtime deps, the API surface, or anything the images package: `docker compose up` still succeeds from a clean state, the `@container` suite passes, and no new write path outside the bind-mounted data dir is introduced. |

---

## 5. Epics & User Stories

Story ID format `US-<epic>.<n>`. Priority: **P0** = Phase 1 blocking, **P1** = Phase 1, **P2** = Phase 2.
Estimates in story points (Fibonacci).

---

### EPIC-1 — Multi-Asset Ledger & Lifecycle Tracking  *(PRD Module 1: FR-1.1, FR-1.2)*

> **Epic goal:** A single ledger that can hold every asset class in FR-1.1 through its full lifecycle,
> with FIFO-correct realised gains and dual-currency cost basis.

---

#### US-1.1 — Typed asset registry and taxonomy
**As a** DIY investor **I want** every asset I own to be classifiable into a supported asset class
**so that** valuation, tax treatment and snapshot membership are derived automatically rather than
chosen by me each time.

**AC**
```gherkin
Scenario: Asset class determines jurisdiction and snapshot membership
  Given an asset of class "FOREIGN_EQUITY"
  When the asset is registered
  Then its jurisdiction must be "FOREIGN"
  And it must be included in 31-Dec compliance snapshots
  And excluded from 31-Mar domestic-only compliance snapshots

Scenario: Unsupported asset class is rejected at the boundary
  Given a payload with assetClass "DOGECOIN_FUTURES"
  When the asset is registered
  Then registration fails with UnsupportedAssetClassError
  And no partial asset record is persisted
```
**DoD:** global DoD + taxonomy table covers all 22 classes in FR-1.1 with an exhaustive-switch test that
fails to compile if a class is added without a jurisdiction mapping.
**Points:** 3 · **Deps:** US-8.1, US-8.4

---

#### US-1.2 — Record an acquisition lot with full cost basis
**As an** investor **I want** each purchase recorded as a discrete lot with trade date, settlement date,
quantity, unit price, brokerage and STT **so that** cost basis and holding period are exact.

**AC**
```gherkin
Scenario: Acquisition lot captures all mandated fields (FR-1.2)
  Given a purchase of 100 shares of "TCS" on 2025-06-10 at ₹3,850.00
  And brokerage ₹20.00, STT ₹385.00, other charges ₹5.50
  When the lot is recorded
  Then the lot stores trade date 2025-06-10 and settlement date 2025-06-12
  And total cost basis equals ₹385,410.50
  And remainingQuantity equals 100

Scenario: Settlement date defaults to T+1 for domestic equity when omitted
  Given a domestic equity purchase on 2025-06-10 with no settlement date
  When the lot is recorded
  Then settlement date is 2025-06-11

Scenario: Negative or zero quantity is rejected
  Given a purchase with quantity 0
  When the lot is recorded
  Then it fails with InvalidQuantityError
```
**DoD:** global DoD + cost-basis worked example in `core-domain/README.md`.
**Points:** 3 · **Deps:** US-1.1

---

#### US-1.3 — Partial and complete exit with FIFO lot allocation
**As an** investor **I want** sells to consume my oldest lots first **so that** realised gains match the
FIFO method the Indian tax authority expects.

**AC**
```gherkin
Scenario: Partial exit consumes oldest lot first
  Given lots: L1 = 100 units @ ₹100 on 2023-01-10, L2 = 50 units @ ₹150 on 2024-06-01
  When 120 units are sold on 2025-09-01 at ₹200
  Then allocation is L1:100 units and L2:20 units
  And L1.remainingQuantity is 0 and L2.remainingQuantity is 30
  And realised gain equals (120 × 200) − (100 × 100 + 20 × 150) = ₹11,000

Scenario: Oversell is rejected atomically
  Given total remaining quantity of 150 units
  When 151 units are sold
  Then it fails with InsufficientQuantityError
  And no lot's remainingQuantity is mutated

Scenario: Complete exit zeroes the position
  Given a single lot of 100 units
  When 100 units are sold
  Then remainingQuantity is 0 and the asset reports positionClosed = true
```
**DoD:** global DoD + property-based test asserting Σ allocated = quantity sold and Σ remaining is
non-increasing across 1,000 random lot/exit sequences.
**Points:** 5 · **Deps:** US-1.2

---

#### US-1.4 — Foreign equity lots with dual-currency cost basis (incl. RSU/ESPP)
**As a** global Indian investor **I want** my US holdings to carry both a USD and an INR cost basis
**so that** portfolio valuation and taxable gains are each computed on the correct rate (ADR-003).

**AC**
```gherkin
Scenario: Partial exit on foreign RSUs with currency conversion (PRD FR-1 AC)
  Given the user owns 100 shares of US stock "AAPL" acquired on 2023-05-10 at $172.50
  When the user sells 40 shares on 2026-02-15 at $180.00 per share
  Then the exit date is recorded as 2026-02-15
  And realised gain is computed using FIFO lot allocation
  And USD proceeds are converted to INR at the trade-date SBI ITBR rate for valuation
  And taxable proceeds are converted at the Rule 115 rate for 2026-01-31
  And the remaining lot quantity is 60 for future snapshot calculations

Scenario: RSU vesting creates a lot at fair market value on vest date
  Given an RSU grant vesting 50 shares on 2025-11-15 with FMV $210.00
  When the vest is recorded
  Then a lot is created with acquisitionDate 2025-11-15 and costPerUnit $210.00
  And the perquisite value in INR is recorded for salary-income reporting

Scenario: ESPP discount is recorded separately from cost basis
  Given an ESPP purchase at 85% of a $200 FMV
  When the lot is recorded
  Then costPerUnit is $170.00
  And perquisiteValue is $30.00 per share
```
**DoD:** global DoD + both rates asserted independently; a test proves the two rates differ and neither
is silently reused for the other.
**Points:** 8 · **Deps:** US-1.3, US-2.4, US-2.5

---

#### US-1.5 — Dividend and interest ingestion with withholding tax
**As an** investor **I want** dividends and interest recorded with tax withheld at source
**so that** other-sources income and DTAA relief are computed correctly.

**AC**
```gherkin
Scenario: Foreign dividend with W-8BEN treaty withholding
  Given a US dividend of $500 received on 2025-08-14 with 25% withheld
  When the income event is recorded
  Then gross dividend is $500.00 and withheld tax is $125.00 and net is $375.00
  And the INR taxable value uses the Rule 115 rate for 2025-07-31
  And the withheld amount is tagged as eligible for foreign tax credit

Scenario: Domestic dividend with TDS under section 194
  Given a domestic dividend of ₹100,000 with ₹10,000 TDS
  When the income event is recorded
  Then ₹100,000 is added to other-sources income
  And ₹10,000 is added to the TDS credit pool for advance tax

Scenario: Auto-reinvested interest creates a new lot
  Given a mutual fund with dividend reinvestment on 2025-09-30
  When the reinvested interest of ₹5,000 at NAV ₹250 is recorded
  Then a new lot of 20 units at ₹250 dated 2025-09-30 is created
```
**Points:** 5 · **Deps:** US-1.4, US-2.4

---

#### US-1.6 — Corporate actions (split, bonus, merger, demerger)
**As an** investor **I want** corporate actions to adjust my lots **so that** quantity and cost basis stay
correct and holding period is preserved.

**AC**
```gherkin
Scenario: Stock split preserves total cost basis and original acquisition date
  Given a lot of 100 shares at ₹1,000 acquired 2023-04-01
  When a 1:5 split is applied on 2025-07-01
  Then the lot becomes 500 shares at ₹200
  And total cost basis is unchanged at ₹100,000
  And acquisitionDate remains 2023-04-01 for holding-period purposes

Scenario: Bonus issue creates a zero-cost lot dated at the bonus record date
  Given a lot of 100 shares
  When a 1:1 bonus is applied on 2025-07-01
  Then a new lot of 100 shares at ₹0 cost dated 2025-07-01 is created
  And the original lot is unchanged
```
**Points:** 5 · **Deps:** US-1.3

---

#### US-1.7 — Mutual fund holdings with folio/scheme identity and NAV valuation
**AC**
```gherkin
Scenario: MF units valued at applicable NAV on the valuation date
  Given a folio holding 1,234.567 units of a scheme with ISIN INF090I01239
  When valued on 2026-03-31 with NAV ₹87.4321
  Then market value equals ₹107,943.06 rounded to 2 decimals

Scenario: NAV unavailable on a non-business day falls back to last published NAV
  Given 2026-03-29 is a Sunday with no published NAV
  When valuation runs for 2026-03-29
  Then the NAV published for 2026-03-27 is used
  And the position is flagged navSource = "LAST_PUBLISHED"
```
**Points:** 5 · **Deps:** US-1.2

---

#### US-1.8 — Statutory schemes: EPF, VPF, NPS (Tier I/II), PPF, Gratuity
**AC**
```gherkin
Scenario: EPF balance accrues employee, employer and interest components
  Given an opening EPF balance of ₹1,000,000 on 2025-04-01
  And monthly employee contribution ₹15,000 and employer ₹15,000
  And a declared interest rate of 8.25% for FY 2025-26
  When the balance is projected to 2026-03-31
  Then contributions of ₹360,000 are added
  And interest is computed on monthly running balances
  And the closing balance is reported with a component breakdown

Scenario: Gratuity is projected from last drawn salary and tenure
  Given last drawn basic + DA of ₹200,000 per month and 12 completed years
  When gratuity is estimated
  Then the accrued value equals 15/26 × 200000 × 12 = ₹1,384,615.38

Scenario: NPS Tier I is flagged as illiquid until age 60
  Given an NPS Tier I holding and a user date of birth implying age 45
  When net worth is computed
  Then the holding is included in net worth
  And flagged liquidity = "LOCKED_UNTIL_60"
```
**Points:** 8 · **Deps:** US-1.1

---

#### US-1.9 — Fixed and recurring deposits with accrued interest
**AC**
```gherkin
Scenario: FD accrues quarterly compounded interest to the valuation date
  Given an FD of ₹1,000,000 at 7.2% p.a. compounded quarterly from 2025-04-01
  When valued on 2026-03-31
  Then the accrued value equals ₹1,073,970.86
  And accrued interest ₹73,970.86 is reported as other-sources income for FY 2025-26
```
**Points:** 3 · **Deps:** US-1.1

---

#### US-1.10 — Alternative assets: real estate, unlisted shares, crypto, gold, SGB
**AC**
```gherkin
Scenario: Real estate holds cost of acquisition separately from current market value
  Given a property purchased on 2019-08-01 for ₹15,000,000 with ₹900,000 stamp duty
  When Schedule AL data is requested
  Then cost of acquisition is reported as ₹15,900,000
  And current market value is reported separately and never substituted for cost

Scenario: Crypto gains are classified as VDA and excluded from LTCG treatment
  Given a crypto holding sold after 36 months at a gain
  When capital gains are classified
  Then the gain is classified as VDA_GAIN taxed at 30% with no indexation
  And losses are flagged as non-set-offable
```
**Points:** 5 · **Deps:** US-1.1

---

#### US-1.11 — Hand loans with interest accrual
**AC**
```gherkin
Scenario: Tracking hand loans with interest (PRD FR-1 AC)
  Given the user lends ₹5,000,000 as a hand loan on 2025-04-01 at 8% p.a. simple interest
  When the snapshot is generated on 2026-03-31
  Then the asset principal is valued at ₹5,000,000
  And accrued interest of ₹400,000 is reflected in total net worth
  And the accrued interest is categorised under "Other Sources" income for advance tax estimation

Scenario: Partial repayment reduces principal and stops interest on the repaid part
  Given a ₹5,000,000 hand loan at 8% simple interest from 2025-04-01
  When ₹2,000,000 principal is repaid on 2025-10-01
  Then interest accrues on ₹5,000,000 for 183 days and on ₹3,000,000 for 182 days
  And accrued interest to 2026-03-31 equals ₹320,547.95

Scenario: Borrower name is stored as a PII reference, never as plain text in AI payloads
  Given a hand loan to borrower "Rajesh Sharma"
  When the asset is serialised for an AI payload
  Then the borrower field reads "[REDACTED_NAME]"
```
**Points:** 5 · **Deps:** US-1.1, US-7.1

---

#### US-1.12 — Custom family savings / chit schemes
**AC**
```gherkin
Scenario: Chit scheme tracks contributions paid and expected payout
  Given a 24-month chit with ₹50,000 monthly contribution started 2025-01-01
  When valued on 2026-03-31
  Then contributions paid to date equal ₹750,000
  And the position reports expectedPayoutDate and any dividend/discount received to date
```
**Points:** 3 · **Deps:** US-1.1

---

#### US-1.13 — Cash in hand and bank balances
**AC**
```gherkin
Scenario: Cash in hand is included in net worth and Schedule AL movable assets
  Given cash in hand of ₹250,000 declared as of 2026-03-31
  When the 31-Mar snapshot is generated
  Then ₹250,000 appears under CASH_IN_HAND
  And is mapped to Schedule AL movable assets
```
**Points:** 2 · **Deps:** US-1.1

---

#### US-1.14 — Liabilities ledger
**AC**
```gherkin
Scenario: Liabilities reduce net worth but are reported separately
  Given assets totalling ₹100,000,000 and a home loan outstanding of ₹8,000,000
  When net worth is computed
  Then gross assets are ₹100,000,000
  And total liabilities are ₹8,000,000
  And net worth is ₹92,000,000
  And Schedule AL reports the liability under its own head, not as a negative asset
```
**Points:** 3 · **Deps:** US-1.1

---

#### US-1.15 — Portfolio valuation engine
**AC**
```gherkin
Scenario: Valuation of a large portfolio meets the performance budget (NFR-2)
  Given a portfolio with 1,000 individual lots across 8 asset classes and 3 currencies
  When full valuation is computed
  Then it completes in under 1,500 milliseconds
  And every foreign position uses the trade-date-appropriate valuation rate

Scenario: Valuation is deterministic
  Given identical inputs and a fixed clock
  When valuation is run twice
  Then both results are byte-identical under canonical JSON serialisation
```
**Points:** 8 · **Deps:** US-1.4 … US-1.14, US-2.5

---

### EPIC-2 — Foreign Currency & SBI ITBR Rate Engine  *(PRD Module 2: FR-2.1)*

#### US-2.1 — FX rate store with provenance
**AC**
```gherkin
Scenario: Every stored rate carries its source and retrieval timestamp
  Given a USD/INR rate of 83.4500 for 2025-07-31
  When the rate is stored
  Then it records source = "SBI_ITBR", rateType = "TTBR", retrievedAt and a sourceDocumentRef
  And storing a second rate for the same (currency, date, source) is idempotent

Scenario: Conflicting rate for the same key is rejected, not overwritten
  Given a stored SBI_ITBR rate of 83.4500 for 2025-07-31
  When a different value 83.9000 is ingested for the same key
  Then a RateConflictError is raised with both values
```
**Points:** 3 · **Deps:** US-8.3

---

#### US-2.2 — SBI ITBR ingestion pipeline
**AC**
```gherkin
Scenario: Daily SBI rate sheet is parsed into rate records
  Given the official SBI forex rate sheet fixture for 2025-07-31
  When the ingestion pipeline runs
  Then TTBR rates for USD, EUR, GBP, SGD, AED are stored with source SBI_ITBR
  And the source document reference is retained for audit

Scenario: Malformed rate sheet does not corrupt the store
  Given a rate sheet fixture with a missing USD column
  When ingestion runs
  Then no rates from that sheet are committed
  And an IngestionFailure is reported naming the missing column
```
**Points:** 5 · **Deps:** US-2.1, US-8.10

---

#### US-2.3 — Fallback hierarchy resolver
**AC**
```gherkin
Scenario: System fallback when SBI rate sheet is delayed (PRD FR-2 AC)
  Given the SBI forex sheet is unreleased for a bank holiday on the trade date
  When the asset transaction is logged
  Then the RBI reference rate for the nearest prior working day is applied
  And the transaction is flagged "Rate Source: RBI Fallback (Pending SBI ITBR Finalization)"

Scenario: Fallback order is SBI → RBI → ECB → OANDA
  Given no SBI and no RBI rate exists for 2025-12-25
  And an ECB rate exists for 2025-12-24
  Then the ECB rate for 2025-12-24 is used with source ECB and isFallback = true

Scenario: Complete rate unavailability fails loudly
  Given no rate from any source for the requested date or any prior date
  When a conversion is attempted
  Then it fails with RateUnavailableError
  And no implicit 1.0 or last-known-good rate is substituted
```
**Points:** 5 · **Deps:** US-2.1

---

#### US-2.4 — Rule 115 resolver
**AC**
```gherkin
Scenario: Automated SBI ITBR fetch and Rule 115 compliance (PRD FR-2 AC)
  Given a US dividend is received on 2025-08-14
  When the currency conversion engine runs
  Then the SBI TTBR rate published for 2025-07-31 is used
  And the USD dividend is converted to INR for taxable income computation

Scenario: January transaction uses the prior December rate
  Given a transaction on 2026-01-05
  When the Rule 115 rate is resolved
  Then the rate for 2025-12-31 is used

Scenario: Preceding month-end falling on a non-publishing day walks backwards
  Given no SBI rate published for 2025-08-31 (a Sunday)
  When the Rule 115 rate for a September transaction is resolved
  Then the last published SBI rate on or before 2025-08-31 is used
  And the resolution path is recorded for audit
```
**Points:** 5 · **Deps:** US-2.3

---

#### US-2.5 — Dual-rate conversion service (ADR-003)
**AC**
```gherkin
Scenario: A single foreign transaction yields two distinct INR amounts
  Given a sale of $7,200 on 2026-02-15
  And an SBI ITBR trade-date rate of 84.10 and a Rule 115 rate (2026-01-31) of 83.55
  When the conversion service runs
  Then valuationInr equals ₹605,520.00
  And taxableInr equals ₹601,560.00
  And both are persisted on the transaction with their rate provenance

Scenario: Tax computation never consumes the valuation rate
  Given a transaction with both rates populated
  When the capital gains engine computes taxable gain
  Then only taxableInr is read
```
**Points:** 5 · **Deps:** US-2.4

---

#### US-2.6 — Retroactive rate finalisation and reconciliation
**AC**
```gherkin
Scenario: Late-published SBI rate supersedes a fallback and triggers recomputation
  Given a transaction converted using an RBI fallback rate flagged as pending
  When the official SBI ITBR rate for that date is later ingested
  Then the transaction's rates are recomputed
  And an amendment record links the old and new values
  And any frozen snapshot containing that transaction is NOT mutated but is flagged "supersededRateAvailable"
```
**Points:** 8 · **Deps:** US-2.5, US-3.1

---

### EPIC-3 — Historical Snapshot & Comparison System  *(PRD Module 3: FR-3.1)*

#### US-3.1 — Immutable content-addressed snapshot
**AC**
```gherkin
Scenario: Snapshot is frozen and content-addressed
  Given a generated snapshot
  When any mutation of its positions is attempted
  Then it fails with SnapshotImmutableError
  And the stored contentHash matches SHA-256 of its canonical JSON

Scenario: Regenerating an existing snapshot detects divergence
  Given snapshot "DOM_31MAR2026" exists with hash H1
  When regeneration produces hash H2 ≠ H1
  Then a SnapshotDivergenceError is raised naming the differing positions
  And the original snapshot is left untouched
```
**Points:** 5 · **Deps:** US-1.15

---

#### US-3.2 / US-3.3 — Automatic 31-Mar domestic and 31-Dec foreign compliance snapshots
**AC**
```gherkin
Scenario: Dual compliance snapshot generation (PRD FR-3 AC)
  Given the current system date reaches 2026-04-01
  When the automated snapshot scheduler runs
  Then an immutable snapshot "DOM_31MAR2026" is created containing all domestic holdings as of 31-Mar-2026 EOD
  And when the calendar date reaches 2027-01-01
  Then an immutable snapshot "FOR_31DEC2026" is created for all foreign holdings as of 31-Dec-2026 EOD

Scenario: Scheduler is idempotent
  Given "DOM_31MAR2026" already exists
  When the scheduler runs again on 2026-04-02
  Then no duplicate snapshot is created and no error is raised

Scenario: Domestic snapshot excludes foreign holdings and vice versa
  Given a portfolio with both domestic and foreign assets
  When "DOM_31MAR2026" is generated
  Then it contains only assets with jurisdiction DOMESTIC

Scenario: EOD boundary is Asia/Kolkata (ADR-008)
  Given a transaction timestamped 2026-03-31T23:45:00+05:30
  When the 31-Mar snapshot is generated
  Then the transaction is included
  And a transaction at 2026-04-01T00:15:00+05:30 is excluded
```
**Points:** 8 (combined) · **Deps:** US-3.1

---

#### US-3.4 — Custom on-demand snapshot for an arbitrary date
**AC**
```gherkin
Scenario: Custom historical snapshot reconstructs state as of a past date
  Given transactions spanning 2023-01-01 to 2026-08-02
  When the user requests a custom snapshot for 2024-11-30
  Then only transactions on or before 2024-11-30 IST EOD are included
  And prices/NAVs/FX as of 2024-11-30 are used

Scenario: Future-dated snapshot is rejected
  Given a request for a snapshot dated 2027-01-01 with system date 2026-08-02
  Then it fails with FutureSnapshotError
```
**Points:** 5 · **Deps:** US-3.1

---

#### US-3.5 / US-3.6 — Comparison engine: snapshot↔snapshot and snapshot↔live
**AC**
```gherkin
Scenario: Live vs historical snapshot variance analysis (PRD FR-3 AC)
  Given snapshot "SNAP_31MAR2025" with total net worth ₹250,000,000
  And live net worth on 2026-08-02 of ₹310,000,000
  When the user executes "Compare Live with SNAP_31MAR2025"
  Then a variance table shows delta net worth of +₹60,000,000 and +24.0%
  And top gainers, new asset additions, complete liquidations and asset-class rebalancing shifts are highlighted

Scenario: Comparison across currencies normalises to INR at each side's own rate
  Given snapshot A valued at 2025-03-31 rates and snapshot B at 2026-03-31 rates
  When compared
  Then each side retains its own FX rate
  And the delta separately attributes price movement and currency movement

Scenario: Comparison meets the performance budget (NFR-2)
  Given two snapshots each containing 1,000 positions
  When the delta is computed
  Then it completes in under 2,000 milliseconds
```
**Points:** 8 (combined) · **Deps:** US-3.4

---

#### US-3.7 — Allocation shift and movement classification
**AC**
```gherkin
Scenario: Positions are classified into movement buckets
  Given snapshot A and snapshot B
  When compared
  Then each position is classified as NEW, LIQUIDATED, INCREASED, DECREASED or UNCHANGED
  And asset-class allocation percentages for both sides sum to 100.00% within ±0.01%
```
**Points:** 5 · **Deps:** US-3.5

---

#### US-3.8 — XIRR / CAGR / absolute return
**AC**
```gherkin
Scenario: XIRR is computed across irregular cash flows
  Given cash flows −₹100,000 on 2023-04-01, −₹50,000 on 2024-04-01, +₹200,000 on 2026-04-01
  When XIRR is computed
  Then the result is 20.94% within a tolerance of 0.01 percentage points

Scenario: XIRR on non-converging inputs fails explicitly
  Given cash flows with no sign change
  When XIRR is computed
  Then it fails with XirrNonConvergenceError rather than returning NaN or 0
```
**Points:** 5 · **Deps:** US-3.5

---

### EPIC-4 — Ingestion, Parsers & Template Engine  *(PRD Module 4: FR-4.1)*

#### US-4.1 — Ingestion pipeline framework
**AC**
```gherkin
Scenario: Import is staged and atomically committed
  Given a file with 100 valid rows and 3 invalid rows
  When the import runs in strict mode
  Then nothing is committed and all 3 errors are reported with row numbers
  And when run in lenient mode
  Then 100 rows are committed and 3 are reported as rejected with reasons

Scenario: Every imported record retains its provenance
  Given any successful import
  Then each created record stores sourceFile, sourceRow, parserName and importedAt
```
**Points:** 8 · **Deps:** US-8.3

---

#### US-4.2 — CAMS / KFintech CAS PDF parser
**AC**
```gherkin
Scenario: CAMS CAS PDF auto-ingestion (PRD FR-4 AC)
  Given the user uploads a password-protected CAMS Consolidated Account Statement PDF
  When the user provides the correct decryption password
  Then all folio numbers, ISINs, scheme names, transaction dates, NAVs and units are parsed
  And the domestic mutual fund portfolio is populated without manual entry

Scenario: PDF password is never persisted (NFR-1)
  Given a CAS PDF is decrypted with a password
  When the import completes
  Then the password does not appear in the database, logs, temp files or error payloads
  And the in-memory buffer holding it is overwritten before release

Scenario: Wrong password fails cleanly
  Given an incorrect decryption password
  Then it fails with PdfDecryptionError
  And no partial portfolio data is written
```
**Points:** 13 · **Deps:** US-4.1, US-7.1

---

#### US-4.3 — Zerodha Tax P&L (XLSX) and Tradebook (CSV) parser
**AC**
```gherkin
Scenario: Tradebook CSV populates lots and exits
  Given a Zerodha tradebook fixture with 40 buy and 25 sell rows
  When imported
  Then 40 acquisition lots and 25 exit transactions are created
  And FIFO allocations are recomputed deterministically

Scenario: Tax P&L XLSX cross-checks computed realised gains
  Given a Zerodha Tax P&L XLSX for FY 2025-26
  When imported alongside the tradebook
  Then the system's computed realised gains are reconciled against the broker's figures
  And any variance greater than ₹1 is reported as a reconciliation exception, not silently accepted
```
**Points:** 8 · **Deps:** US-4.1, US-1.3

---

#### US-4.4 — Vested account activity CSV parser
**AC**
```gherkin
Scenario: Vested CSV creates foreign equity lots with USD basis
  Given a Vested account activity CSV containing buys, sells, dividends and fees
  When imported
  Then foreign equity lots are created with USD cost basis
  And both valuation and Rule 115 rates are resolved per transaction
  And fractional share quantities to 6 decimal places are preserved exactly
```
**Points:** 8 · **Deps:** US-4.1, US-1.4

---

#### US-4.5 — E*TRADE portfolio / transaction / GainsKeeper parser
**AC**
```gherkin
Scenario: E*TRADE transaction history distinguishes RSU vest from open-market buy
  Given an E*TRADE transaction CSV containing an RSU release and a market purchase
  When imported
  Then the RSU release creates a lot with perquisite value recorded
  And the market purchase creates an ordinary lot
```
**Points:** 8 · **Deps:** US-4.1, US-1.4

---

#### US-4.6 — Standardised CSV templates and generic template parser
**AC**
```gherkin
Scenario: Custom asset import via predefined template (PRD FR-4 AC)
  Given the user downloads "Custom_HandLoans_Template.csv"
  When the user populates borrower details, principal, interest rate and start date and uploads the CSV
  Then the ingestion engine validates headers, parses rows and adds entries to the hand loan asset ledger

Scenario: Header mismatch is rejected with actionable guidance
  Given a CSV whose headers omit "interest_rate_pct"
  When imported
  Then it fails with TemplateHeaderMismatchError listing missing and unexpected headers

Scenario: Templates are generated for every manual asset class
  When templates are listed
  Then downloadable templates exist for hand loans, real estate, cash, chit funds, unlisted shares and generic brokers
```
**Points:** 5 · **Deps:** US-4.1

---

#### US-4.7 — Idempotent re-import and duplicate detection
**AC**
```gherkin
Scenario: Re-importing the same file creates no duplicates
  Given a tradebook already imported
  When the identical file is imported again
  Then zero new records are created and a DuplicateImport summary is returned

Scenario: Overlapping date-range imports merge without duplication
  Given imports for Apr–Sep and Jul–Dec with overlapping July–September rows
  When both are imported
  Then each underlying transaction exists exactly once, matched on a natural key
```
**Points:** 5 · **Deps:** US-4.1

---

#### US-4.8 — Import error reporting UX
**AC**
```gherkin
Scenario: Row-level errors are surfaced with correction guidance
  Given an import with a malformed date "31/13/2025" on row 17
  Then the error report names row 17, column "trade_date", the offending value and the expected format
```
**Points:** 3 · **Deps:** US-4.1

---

### EPIC-5 — Income Tax, Advance Tax & Capital Gains Engine  *(PRD Module 5: FR-5.1–5.3)*

#### US-5.1 — FY / AY calendar utilities
**AC**
```gherkin
Scenario: Financial year derivation
  Given the date 2026-03-31
  Then the financial year is "2025-26" and the assessment year is "2026-27"
  And given 2026-04-01
  Then the financial year is "2026-27" and the assessment year is "2027-28"

Scenario: Advance tax quarter boundaries
  Then Q1 due date is 15-Jun, Q2 15-Sep, Q3 15-Dec and Q4 15-Mar of the relevant FY
```
**Points:** 2 · **Deps:** US-8.4

---

#### US-5.2 — Versioned tax rule table (ADR-005)
**AC**
```gherkin
Scenario: Rules are resolved by financial year
  Given rule sets for FY 2024-25 and FY 2025-26
  When computing tax for FY 2025-26
  Then only FY 2025-26 rates are applied

Scenario: Missing rule set fails loudly
  Given no rule set for FY 2030-31
  When computing tax for that year
  Then it fails with TaxRulesUnavailableError
  And does not fall back to the most recent year
```
**Points:** 5 · **Deps:** US-5.1

---

#### US-5.3 — Form 16 (Part A & B) parser and manual income entry
**AC**
```gherkin
Scenario: Form 16 Part B yields gross salary, deductions and TDS
  Given a Form 16 Part B fixture for FY 2025-26
  When parsed
  Then gross salary, exempt allowances, chapter VI-A deductions and total TDS deducted are extracted
  And PAN and TAN are stored as PII references, never as plain text in AI payloads

Scenario: Form 16 Part A TDS totals reconcile against Part B
  Given Part A quarterly TDS totalling ₹1,850,000 and Part B stating ₹1,840,000
  When parsed
  Then a reconciliation warning names both figures
  And the user is required to resolve it before advance tax is computed

Scenario: Manual income entry is accepted when no Form 16 exists
  Given manually entered salary, house property and other-sources income
  Then the tax computation proceeds identically to a parsed Form 16
```
**Points:** 8 · **Deps:** US-5.2, US-7.1

---

#### US-5.4 — Old vs New regime slab computation
**AC**
```gherkin
Scenario: Both regimes are computed and the cheaper one is recommended
  Given a gross salary of ₹12,000,000 for FY 2025-26 with ₹150,000 of 80C and ₹50,000 of 80D
  When tax is computed
  Then liability under both the old and new regimes is reported
  And the regime with lower total liability is flagged "recommended"
  And the reason lists the deductions forgone under the new regime

Scenario: Standard deduction differs by regime
  Then the new regime applies its own standard deduction figure from the FY rule table
  And the old regime applies its own, with no cross-contamination
```
**Points:** 8 · **Deps:** US-5.3

---

#### US-5.5 — Surcharge, marginal relief and cess
**AC**
```gherkin
Scenario: Surcharge bands apply at the mandated thresholds (FR-5.1)
  Then income above ₹50L attracts 10%, above ₹1Cr 15%, above ₹2Cr 25% surcharge per the FY rule table
  And health & education cess of 4% applies on tax plus surcharge

Scenario: Marginal relief caps the surcharge cliff
  Given taxable income of ₹5,010,000 (just over the ₹50L threshold)
  When tax is computed
  Then marginal relief is applied so that the incremental tax does not exceed the incremental income
  And the relief amount is itemised in the computation trace

Scenario: Surcharge on capital gains is capped at 15%
  Given total income above ₹2Cr including LTCG
  Then surcharge on the capital gains component is capped at 15%
  And the uncapped rate applies to the remaining income
```
**Points:** 8 · **Deps:** US-5.4

---

#### US-5.6 — HNI classification (ADR-004)
**AC**
```gherkin
Scenario: HNI flag is set on either the income or the net worth test
  Given total income of ₹6,000,000 and net worth of ₹40,000,000
  Then hniStatus is true with reason "INCOME_ABOVE_50L"
  And given total income of ₹3,000,000 and net worth of ₹120,000,000
  Then hniStatus is true with reason "NET_WORTH_ABOVE_10CR"

Scenario: HNI status enables Schedule AL requirement
  Given hniStatus is true because income exceeds ₹50L
  Then Schedule AL generation is marked as required for that AY
```
**Points:** 3 · **Deps:** US-5.5, US-1.15

---

#### US-5.7 — Capital gains classifier (holding period)
**AC**
```gherkin
Scenario: Listed domestic equity holding period boundary (FR-5.2)
  Given listed domestic equity held for exactly 12 months
  Then the gain is classified STCG
  And held for 12 months and 1 day
  Then the gain is classified LTCG

Scenario: Foreign equity holding period boundary
  Given foreign equity held for exactly 24 months
  Then the gain is classified STCG taxed at slab rate
  And held for 24 months and 1 day
  Then the gain is classified LTCG at 12.5% without indexation

Scenario: Debt funds and hand loan interest are slab-taxed
  Then debt fund gains, FD interest and hand loan interest are taxed at the applicable slab rate
  And are never classified as LTCG
```
**Points:** 5 · **Deps:** US-5.2, US-1.3

---

#### US-5.8 — Capital gains computation with exemption, grandfathering and indexation
**AC**
```gherkin
Scenario: LTCG exemption of ₹1.25 lakh applies once per FY
  Given listed equity LTCG of ₹300,000 in FY 2025-26
  Then taxable LTCG is ₹175,000 taxed at 12.5% = ₹21,875
  And the exemption is not applied a second time to a later sale in the same FY

Scenario: Grandfathering uses the higher of cost and 31-Jan-2018 FMV
  Given a lot acquired 2015-06-01 at ₹100 with 31-Jan-2018 FMV of ₹180, sold at ₹250
  Then the cost of acquisition used is ₹180 and the gain is ₹70 per unit
  And given the same lot sold at ₹150
  Then the cost used is ₹150 (capped at sale price) and the gain is ₹0

Scenario: STCG on listed domestic equity is taxed at 20%
  Given listed domestic equity STCG of ₹500,000 in FY 2025-26
  Then the tax on it is ₹100,000 before surcharge and cess

Scenario: Foreign capital gains use the Rule 115 rate on both legs
  Given a foreign lot acquired 2023-05-10 and sold 2026-02-15
  Then acquisition cost is converted at the Rule 115 rate for 2023-04-30
  And proceeds at the Rule 115 rate for 2026-01-31
```
**Points:** 13 · **Deps:** US-5.7, US-2.5

---

#### US-5.9 — Other-sources income aggregation
**AC**
```gherkin
Scenario: Hand loan interest, FD interest and dividends aggregate into other sources
  Given hand loan accrued interest ₹400,000, FD interest ₹73,970.86 and dividends ₹100,000
  Then total other-sources income is ₹573,970.86
  And each component is itemised with its source asset
```
**Points:** 3 · **Deps:** US-1.11, US-1.9, US-1.5

---

#### US-5.10 — Quarterly advance tax engine
**AC**
```gherkin
Scenario: Advance tax calculation for Q3 with capital gains (PRD FR-5 AC)
  Given a user with estimated salary income in the 30% slab with 10% surcharge
  And realised STCG on Indian equities of ₹500,000 on 2025-11-10
  When the advance tax calculation runs for the 15-Dec (Q3) installment
  Then the system computes 75% of total tax liability (salary tax + 20% STCG + surcharge + 4% cess)
  And deducts TDS already remitted by the employer per the Form 16 projection
  And displays the exact net advance tax payable for the Q3 installment

Scenario: Cumulative installments net off prior payments
  Given ₹300,000 already paid across Q1 and Q2
  When the Q3 requirement is ₹900,000 cumulative
  Then the Q3 payable is ₹600,000

Scenario: Capital gains realised after a quarter cutoff are excluded from that quarter
  Given STCG realised on 2025-12-20
  When the Q3 (15-Dec) computation runs
  Then that gain is excluded
  And it is included from Q4 onwards

Scenario: Cumulative percentages follow FR-5.3
  Then Q1 requires 15%, Q2 45%, Q3 75% and Q4 100% of estimated annual liability
```
**Points:** 13 · **Deps:** US-5.8, US-5.9, US-5.5

---

#### US-5.11 — Foreign tax credit / DTAA relief
**AC**
```gherkin
Scenario: US dividend withholding is relieved up to the Indian tax on that income
  Given a US dividend with $125 withheld at the 25% treaty rate
  And Indian tax on that dividend income of ₹8,000 equivalent
  When relief is computed
  Then credit is the lower of foreign tax paid and Indian tax on the doubly-taxed income
  And the excess is reported as non-creditable, not carried silently
```
**Points:** 8 · **Deps:** US-5.10, US-1.5

---

#### US-5.12 — Tax computation explainability trace
**AC**
```gherkin
Scenario: Every computed figure has an auditable derivation
  Given a completed tax computation
  When the trace is requested
  Then each line item shows its inputs, the rule reference (e.g. "FY2025-26 §surcharge.band2") and the arithmetic
  And the sum of trace line items equals the reported total exactly
```
**Points:** 5 · **Deps:** US-5.10

---

### EPIC-6 — HNI Compliance: Schedule FA & Schedule AL  *(PRD Module 6: FR-6.1, FR-6.2)*

#### US-6.1 — Peak value computation over the calendar year
**AC**
```gherkin
Scenario: Peak holding value is the maximum daily value in the calendar year
  Given a foreign holding valued daily from 2025-01-01 to 2025-12-31
  When peak value is computed
  Then it equals the maximum of daily (quantity × price × FX) across the year
  And both the USD and INR peak values with their peak dates are reported

Scenario: Peak value accounts for quantity changes mid-year
  Given 100 shares until 2025-06-30 and 40 shares thereafter
  Then the peak calculation uses the quantity held on each date
```
**Points:** 8 · **Deps:** US-3.4, US-2.5

---

#### US-6.2 — Schedule FA Table A3 generator
**AC**
```gherkin
Scenario: Generating Schedule FA output for US stocks (PRD FR-6 AC)
  Given the foreign snapshot for 31-Dec-2025
  When the user selects "Export Schedule FA Report"
  Then the peak holding value in USD and INR during 2025-01-01 to 2025-12-31 is calculated
  And the closing value on 2025-12-31 is computed using the SBI ITBR rate
  And the output is formatted into a Table A3 compliant JSON/CSV structure ready for ITR upload

Scenario: Table A3 includes gross dividends and gross capital gains for the calendar year
  Then gross amount paid/credited (dividends) and gross proceeds from sale during the calendar year are reported
  And these use the calendar year, not the financial year

Scenario: Assets held for part of the year are reported with acquisition date
  Given a foreign asset acquired 2025-08-01
  Then Table A3 reports the acquisition date and a peak computed only over the held period
```
**Points:** 13 · **Deps:** US-6.1

---

#### US-6.3 — Schedule FA Table D generator (foreign bank / custodial accounts)
**AC**
```gherkin
Scenario: Foreign custodial account is reported with peak and closing balance
  Given a foreign brokerage cash balance across 2025
  Then Table D reports account number as a PII reference, institution name, peak balance and closing balance in INR
```
**Points:** 5 · **Deps:** US-6.1

---

#### US-6.4 — Schedule AL generator
**AC**
```gherkin
Scenario: Schedule AL reports cost of acquisition, not market value (FR-6.2)
  Given a property purchased for ₹15,900,000 now worth ₹32,000,000 on 2026-03-31
  When Schedule AL is generated for AY 2026-27
  Then immovable property is reported at ₹15,900,000

Scenario: Schedule AL is only generated when required
  Given total income of ₹4,000,000 (below ₹50L)
  Then Schedule AL generation reports notRequired with the reason

Scenario: All Schedule AL heads are populated
  Then immovable property, financial assets, cash in hand, loans and advances given, jewellery, vehicles
  And corresponding liabilities are each populated from the 31-Mar snapshot
```
**Points:** 8 · **Deps:** US-5.6, US-1.14, US-3.2

---

#### US-6.5 — ITR-ready export (JSON / CSV)
**AC**
```gherkin
Scenario: Exports validate against the declared schema
  Given generated Schedule FA and AL data
  When exported
  Then the JSON validates against the bundled schema
  And the CSV column order matches the ITR utility's expected order
  And monetary values are rounded to whole rupees per the export specification
```
**Points:** 5 · **Deps:** US-6.2, US-6.4

---

### EPIC-7 — PII Masking Layer for AI Services  *(PRD Module 7: FR-7.1, FR-7.2)*

#### US-7.1 — Regex-based PII masking rules
**AC**
```gherkin
Scenario: PAN is masked
  Given text containing "ABCDE1234F"
  Then the output contains "[REDACTED_PAN]" and not the original

Scenario: Aadhaar is masked in spaced and unspaced forms
  Given "2345 6789 0123" and "234567890123"
  Then both become "[REDACTED_AADHAAR]"

Scenario: DP ID / Client ID / Folio are masked
  Given "DPID: 1208160000123456" and "Folio No: 91234567/89"
  Then both identifiers become "[REDACTED_DEMAT_ACCOUNT]"

Scenario: Email, phone and address are masked
  Given "rajesh@example.com", "+91 98765 43210" and "Flat 4B, MG Road, Bengaluru 560001"
  Then each becomes "[REDACTED_CONTACT]"

Scenario: Transaction and order IDs are masked
  Given "Order ID: 250810400123456"
  Then it becomes "[REDACTED_TXN_ID]"

Scenario: Non-PII numerics are preserved
  Given "holding 500 shares of TCS at ₹3,850.00"
  Then the quantities, symbol and price are unchanged
```
**Points:** 8 · **Deps:** US-8.1

---

#### US-7.2 — NER-based name masking
**AC**
```gherkin
Scenario: Person names are masked while company names survive
  Given "Analyze portfolio for Rajesh Sharma holding 500 shares of Tata Consultancy Services"
  Then "Rajesh Sharma" becomes "[REDACTED_NAME]"
  And "Tata Consultancy Services" is preserved

Scenario: NER runs entirely locally
  When name masking executes
  Then no network request is issued
```
**Points:** 8 · **Deps:** US-7.1

---

#### US-7.3 — Full masking pipeline (PRD FR-7 AC)
**AC**
```gherkin
Scenario: PII scrubbing prior to LLM prompt submission (PRD FR-7 AC)
  Given the raw prompt "Analyze portfolio for Rajesh Sharma, PAN: ABCDE1234F, DPID: 1208160000123456 holding 500 shares of TCS"
  When the prompt passes through the PII anonymization proxy
  Then the payload sent to the LLM reads exactly:
    "Analyze portfolio for [REDACTED_NAME], PAN: [REDACTED_PAN], DPID: [REDACTED_DEMAT_ACCOUNT] holding 500 shares of TCS"
  And no PII entity leaks to external API logs

Scenario: Structured portfolio payloads are masked recursively
  Given a nested portfolio JSON containing borrowerName, panNumber and folioNo at three nesting levels
  Then every PII field at every level is masked
  And the JSON structure and all non-PII values are unchanged
```
**Points:** 5 · **Deps:** US-7.2

---

#### US-7.4 — Fail-closed egress guard (ADR-007)
**AC**
```gherkin
Scenario: Residual PII aborts the AI call
  Given a masking rule gap that leaves a PAN in the payload
  When the egress guard scans the post-mask payload
  Then it throws PiiLeakError and the outbound request is never dispatched

Scenario: All AI egress is funnelled through the guard
  Then a static test asserts that no module outside EgressGateway imports an HTTP client for AI endpoints
```
**Points:** 5 · **Deps:** US-7.3

---

#### US-7.5 — Deterministic pseudonymisation with local reversal map
**AC**
```gherkin
Scenario: The same entity maps to the same token within one session
  Given "Rajesh Sharma" appears three times in one payload
  Then all three become the same token "[REDACTED_NAME_1]"
  And a different person becomes "[REDACTED_NAME_2]"

Scenario: The reversal map never leaves the device
  Then the map is stored only in the encrypted local vault
  And is excluded from every export and every outbound payload
```
**Points:** 5 · **Deps:** US-7.3

---

### EPIC-8 — Platform, Persistence & NFRs  *(PRD §4)*

#### US-8.1 — Monorepo scaffolding and toolchain
**AC**
```gherkin
Scenario: Layering violations fail the build
  Given a domain package importing from apps/
  When lint runs
  Then the build fails with an import-boundary violation

Scenario: Strict TypeScript is enforced
  Then tsconfig.base.json sets strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes
  And any use of `any` in packages/ fails lint
```
**Points:** 5 · **Deps:** —

---

#### US-8.2 — Encrypted local persistence (NFR-1)
**AC**
```gherkin
Scenario: Data at rest is encrypted with page-level AES-256 (ADR-015)
  Given a vault containing portfolio data
  When the raw database file is inspected
  Then no plaintext PAN, name, folio number or monetary value is present

Scenario: Schema metadata is encrypted, not just values (ADR-015)
  Given a vault whose schema includes a table named "hand_loans"
  When the raw database file is inspected
  Then the table name does not appear in plaintext
  And no column name appears in plaintext
  And the file does not begin with the "SQLite format 3" magic header

Scenario: Wrong passphrase fails without leaking whether data exists
  Given an incorrect passphrase
  Then unlocking fails with VaultUnlockError
  And the error reveals nothing about vault contents

Scenario: Tampered ciphertext is detected
  Given a modified byte in the encrypted database file
  Then reading fails with an integrity error and no data is returned
  And the failure occurs even when the correct passphrase is supplied

Scenario: The derived key never touches disk and is zeroised on lock (ADR-014)
  Given an unlocked vault
  When the vault is locked
  Then the derived key buffer is zeroised
  And the passphrase appears in no file, log line or error payload
```
**Points:** 8 · **Deps:** US-8.1

---

#### US-8.3 — Repository layer and migrations
**AC**
```gherkin
Scenario: Migrations are forward-only and versioned
  Then applying migrations to an empty database produces the current schema version
  And re-running is a no-op

Scenario: Repositories return domain objects, never raw rows
  Then every repository method's return type is a domain type with Money and Decimal already constructed
```
**Points:** 5 · **Deps:** US-8.2

---

#### US-8.4 — Money and Decimal value objects (ADR-002)
**AC**
```gherkin
Scenario: Currency mismatch is a compile-time or runtime error
  Given Money(100, "INR") and Money(100, "USD")
  When they are added
  Then it fails with CurrencyMismatchError

Scenario: Rounding is explicit and half-up by default for currency display
  Given ₹2.005
  When rounded to 2 decimals
  Then the result is ₹2.01

Scenario: Tax payable rounds to the nearest ₹10 per section 288B
  Given a computed tax of ₹123,456
  Then the reported payable is ₹123,460
```
**Points:** 5 · **Deps:** US-8.1

---

#### US-8.5 — Application shell UI
**AC**
```gherkin
Scenario: Core navigation exists
  Then the UI exposes Dashboard, Ledger, Import, Snapshots, Tax, Compliance and Settings

Scenario: The dashboard shows net worth with an asset-class breakdown
  Given an unlocked vault with holdings
  Then net worth in INR, asset-class allocation and a snapshot-comparison entry point are visible
```
**Points:** 13 · **Deps:** US-8.3, US-1.15

---

#### US-8.6 — Headless CLI runner
**AC**
```gherkin
Scenario: CLI can import, snapshot and compute tax without the UI
  Then `porttrack import --file <f> --parser zerodha`, `porttrack snapshot --as-of 2026-03-31`
  And `porttrack tax advance --fy 2025-26 --quarter Q3` each run and exit 0
  And exit non-zero with a machine-readable error on failure
```
**Points:** 5 · **Deps:** US-8.3

---

#### US-8.7 — Performance budget harness (NFR-2)
**AC**
```gherkin
Scenario: Budgets are enforced in CI
  Then a benchmark test fails the build if valuation of 1,000 lots exceeds 1,500 ms
  Or if snapshot delta computation on 1,000 positions exceeds 2,000 ms
```
**Points:** 5 · **Deps:** US-1.15, US-3.5

---

#### US-8.8 — Backup, restore and export
**AC**
```gherkin
Scenario: Encrypted backup round-trips exactly
  Given a vault with holdings and snapshots
  When backed up and restored into a fresh vault
  Then every snapshot contentHash matches the original
```
**Points:** 5 · **Deps:** US-8.2

---

#### US-8.9 — No-PII logging guarantee
**AC**
```gherkin
Scenario: Logs never contain PII
  Given an operation that processes a PAN, a folio number and a borrower name
  When logs are captured
  Then no log line matches any PII pattern
  And error objects thrown across package boundaries carry no PII in their message or cause chain
```
**Points:** 3 · **Deps:** US-7.1

---

#### US-8.10 — EgressGateway and offline-by-default (ADR-010)
**AC**
```gherkin
Scenario: No network call occurs without explicit user action
  Given the app starts and the vault is unlocked
  Then zero outbound requests are issued

Scenario: All egress is auditable
  Then every outbound request is recorded locally with destination, purpose, timestamp and payload byte size
```
**Points:** 5 · **Deps:** US-8.1

---

#### US-8.11 — Backend API service (`apps/api`)
**As a** containerized frontend **I want** a backend HTTP service exposing the portfolio use cases
**so that** the SPA can run in its own container without embedding the domain engines.

**AC**
```gherkin
Scenario: API exposes the use cases the SPA needs
  Then POST /api/vault/unlock, GET /api/portfolio/valuation, POST /api/snapshots,
       GET /api/snapshots/:id/compare, POST /api/imports and GET /api/tax/advance
  And each returns a typed JSON contract validated against a shared schema

Scenario: The API is a thin shell with no business logic
  Then every route handler delegates to app-services
  And a static test asserts no route file imports a domain package directly

Scenario: Health endpoint reports readiness distinctly from liveness
  Given the process is up but the vault is locked
  Then GET /api/health/live returns 200
  And GET /api/health/ready returns 503 with reason "VAULT_LOCKED"

Scenario: Vault passphrase is never logged or persisted (ADR-014)
  Given a vault unlock request
  Then the passphrase appears in no log line, no error payload and no file on disk
```
**Points:** 8 · **Deps:** US-8.3, US-8.9

---

### EPIC-9 — Containerized Deployment & Host-Native Persistence  *(PRD Module 8: FR-8.1–8.3, NFR-4)*

> **Epic goal:** `docker compose up` on a clean host yields a working frontend + backend, with the
> encrypted database living on the host's own disk where the user can see and back it up.

---

#### US-9.1 — Backend container image (`porttrack-api`)
**As an** operator **I want** the backend packaged as a self-contained image **so that** it runs on any
host without a Node toolchain.

**AC**
```gherkin
Scenario: Image builds and runs with no host toolchain
  Given a host with only Docker installed
  When "docker build -f docker/api.Dockerfile ." runs
  Then the image builds successfully
  And "docker run" starts the API and /api/health/live returns 200

Scenario: Multi-stage build excludes build tooling from the runtime layer
  Given the built runtime image
  Then it contains no devDependencies, no TypeScript compiler and no test files
  And the image is under 400 MB

Scenario: Container runs as a non-root user (FR-8.3)
  When "id -u" is executed inside the running container
  Then the result is not 0

Scenario: Root filesystem is read-only except data and tmp
  When a write to /app is attempted inside the container
  Then it fails with a read-only filesystem error
  And writes to /var/lib/porttrack and /tmp succeed

Scenario: Base image is pinned by digest
  Then the Dockerfile FROM line references a sha256 digest, not a floating tag
```
**Points:** 8 · **Deps:** US-8.11

---

#### US-9.2 — Frontend container image (`porttrack-web`)
**AC**
```gherkin
Scenario: SPA is served from the container with API proxying
  Given the stack is running
  When the browser requests "/"
  Then the SPA loads
  And a request to "/api/health/live" is proxied to the backend and returns 200

Scenario: Deep links resolve to the SPA (history fallback)
  When "/snapshots/DOM_31MAR2026" is requested directly
  Then the SPA index is served with HTTP 200, not a 404

Scenario: The PII masker ships in the browser bundle (ADR-013)
  Then the built SPA bundle contains the pii-masker module
  And a static test asserts apps/api does not import the masker's masking entry point

Scenario: Frontend container runs as non-root with a read-only filesystem
  Then the effective UID is non-zero and the root filesystem is read-only
```
**Points:** 8 · **Deps:** US-8.5, US-9.1

---

#### US-9.3 — Compose stack orchestration
**AC**
```gherkin
Scenario: Clean-host bring-up with no local toolchain (PRD FR-8 AC)
  Given a host with only Docker and Docker Compose installed
  And no Node.js, pnpm or build toolchain present
  When the user runs "docker compose up"
  Then the frontend is reachable on the published port
  And the backend health endpoint reports healthy
  And the user can unlock a vault and view the dashboard

Scenario: Only the web service publishes a host port
  When the running stack's port bindings are inspected
  Then porttrack-web publishes a host port
  And porttrack-api publishes none and is reachable only on the internal network

Scenario: Web waits for API readiness before accepting traffic
  Given the API takes 3 seconds to become ready
  Then compose's depends_on condition service_healthy gates the web container

Scenario: Egress is denied by default and opt-in via profile (ADR-010)
  Given the default stack is running
  When the API attempts an outbound request to an external host
  Then it fails
  And when started with "docker compose -f compose.yaml -f compose.egress.yaml up"
  Then outbound requests to the allow-listed FX hosts succeed
```
**Points:** 8 · **Deps:** US-9.1, US-9.2

---

#### US-9.4 — Host-native bind-mount persistence (ADR-012, FR-8.2)
**As a** user **I want** my encrypted database on my own disk **so that** I can back it up, move it and
never lose it to a container lifecycle event.

**AC**
```gherkin
Scenario: Database persists on the host disk across container destruction (PRD FR-8 AC)
  Given a running stack with portfolio data and a snapshot "DOM_31MAR2026"
  When the user runs "docker compose down" and then "docker compose up" again
  Then the vault unlocks with the same passphrase
  And snapshot "DOM_31MAR2026" is present with an identical contentHash
  And the database file is visible on the host filesystem at the configured data directory

Scenario: Database survives an image rebuild (PRD FR-8 AC)
  Given a running stack with existing portfolio data
  When the images are rebuilt with "docker compose build --no-cache" and the stack is restarted
  Then all pre-existing data remains intact and readable

Scenario: Data directory is a bind mount, not a Docker-managed volume
  When the container's mounts are inspected
  Then the data mount Type is "bind"
  And its Source is an absolute path on the host filesystem

Scenario: Data directory location is configurable
  Given PORTTRACK_DATA_DIR is set to "/mnt/backup/porttrack"
  When the stack starts
  Then the database is created under /mnt/backup/porttrack on the host

Scenario: Nothing is written to the container writable layer
  Given a session that creates a vault, imports a file and generates a snapshot
  When "docker diff" is run on the API container
  Then no database or portfolio file appears in the container's diff
```
**Points:** 8 · **Deps:** US-9.3, US-8.2

---

#### US-9.5 — Host UID/GID ownership mapping
**AC**
```gherkin
Scenario: Bind-mounted files are owned by the host user (FR-8.3)
  Given PORTTRACK_UID and PORTTRACK_GID are set to the invoking host user
  When the stack creates the vault database
  Then the file on the host is owned by that UID/GID
  And the host user can read, copy and delete it without sudo

Scenario: Unwritable data directory fails fast with an actionable message
  Given the host data directory is not writable by the configured UID
  When the container starts
  Then it exits non-zero before touching the database
  And the message names the path, the expected UID/GID and the remediation command
```
**Points:** 5 · **Deps:** US-9.4

---

#### US-9.6 — Secret handling and image hygiene
**AC**
```gherkin
Scenario: No secrets are baked into images (PRD FR-8 AC)
  Given a built backend image
  When its layers are inspected
  Then no vault passphrase, API key or .env file is present in any layer

Scenario: .dockerignore excludes data, secrets and history
  Then .dockerignore excludes ./data, .env, *.db, .git and node_modules

Scenario: Passphrase is supplied at runtime and held in memory only (ADR-014)
  Given the vault is unlocked via the API
  When the container filesystem and environment are inspected
  Then the passphrase is absent from both
```
**Points:** 5 · **Deps:** US-9.1

---

#### US-9.7 — Containerized performance budgets and E2E (NFR-2, NFR-4)
**AC**
```gherkin
Scenario: NFR budgets hold inside the container
  Given the stack is running with a 1,000-lot portfolio
  When valuation is requested through the API
  Then the server-side computation completes in under 1,500 ms
  And snapshot delta computation completes in under 2,000 ms

Scenario: E2E journeys run against the containerized stack
  When the Playwright suite runs with the base URL pointing at the compose stack
  Then the unlock → import → snapshot → compare → advance-tax journey passes
```
**Points:** 5 · **Deps:** US-9.3, US-8.7

---

#### US-9.8 — Cross-platform verification and operator documentation
**AC**
```gherkin
Scenario: The same compose file works on Linux, macOS and Windows/WSL2
  Then bind-mount paths use forward slashes and relative defaults that resolve on all three
  And no host-OS-specific mount flag is required

Scenario: Operator documentation covers the full lifecycle
  Then README documents first-run, data directory configuration, backup, restore,
       upgrade, log inspection and a "where is my data" answer naming the host path
```
**Points:** 3 · **Deps:** US-9.5, US-8.8

---

## 6. Milestones

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Test scaffold** | Repo skeleton, toolchain, **all acceptance tests written and failing (red)** | Every Gherkin scenario in §5 has a named failing test; CI runs and reports the red count |
| **M1 — Kernel** | US-8.1 … US-8.4, US-8.9, US-8.10, US-5.1 | Money/Decimal, encrypted vault, migrations green |
| **M2 — Ledger** | EPIC-1 (US-1.1 … US-1.15) | FIFO, all asset classes, valuation budget met |
| **M3 — FX** | EPIC-2 | Rule 115 + fallback chain + dual rate green |
| **M4 — Snapshots** | EPIC-3 | Dual compliance snapshots, comparison budget met |
| **M5 — Tax** | EPIC-5 | Advance tax Q1–Q4, CG engine, regime comparison green |
| **M6 — Ingestion** | EPIC-4 | CAMS/Zerodha/Vested/E*TRADE/templates green |
| **M7 — Privacy** | EPIC-7 | Masking + fail-closed egress guard green |
| **M8 — UI/API/CLI** | US-8.5, US-8.6, US-8.7, US-8.8, US-8.11 | E2E journeys green |
| **M9 — Containerization** | EPIC-9 (US-9.1 … US-9.8) | `docker compose up` on a clean host works; data survives `down`/rebuild on the host disk; budgets hold in-container |
| **M10 — Compliance (Phase 2)** | EPIC-6 | Schedule FA/AL exports schema-valid |

**Phase 1 (PRD §6)** = M0–M9. **Phase 2** = M10 + broker API sync + AI insights.

> **Sequencing note:** EPIC-9 lands at M9 rather than M1 because the container images package artifacts
> that must exist first (`apps/api`, `apps/web` builds). However, **US-9.1 and US-9.3 are stubbed at M1**
> with a hello-world API and compose file, so the bind-mount and non-root posture are exercised by CI from
> day one. Discovering at M9 that SQLite + bind mount + non-root has a permissions problem would be an
> expensive surprise; a walking-skeleton container at M1 costs half a day and removes that risk (R8).

---

## 7. Implementation Tracker (user-story level)

Status legend: `TODO` · `TESTS_RED` (acceptance tests written and failing) · `WIP` · `REVIEW` · `DONE` · `BLOCKED`

| ID | Story | Epic | PRD FR | Pri | Pts | Milestone | Deps | Test files | Status |
|----|-------|------|--------|-----|-----|-----------|------|-----------|--------|
| US-8.1 | Monorepo scaffolding & toolchain | 8 | §4 | P0 | 5 | M1 | — | `tests/functional/platform/toolchain.spec.ts` | DONE |
| US-8.2 | Encrypted local persistence | 8 | NFR-1 | P0 | 8 | M1 | 8.1 | `packages/persistence/test/vault-encryption.spec.ts` | DONE |
| US-8.3 | Repository layer & migrations | 8 | NFR-1 | P0 | 5 | M1 | 8.2 | `packages/persistence/test/migrations.spec.ts` | DONE |
| US-8.4 | Money & Decimal value objects | 8 | ADR-002 | P0 | 5 | M1 | 8.1 | `packages/shared-kernel/test/money.spec.ts` | DONE |
| US-8.9 | No-PII logging guarantee | 8 | FR-7.1 | P0 | 3 | M1 | 7.1 | `tests/functional/privacy/no-pii-logs.spec.ts` | DONE |
| US-8.10 | EgressGateway / offline-by-default | 8 | §4.3 | P0 | 5 | M1 | 8.1 | `tests/functional/privacy/egress-gateway.spec.ts` | DONE |
| US-5.1 | FY / AY calendar utilities | 5 | FR-5.1 | P0 | 2 | M1 | 8.4 | `packages/tax-engine/test/fy-calendar.spec.ts` | DONE |
| US-1.1 | Typed asset registry & taxonomy | 1 | FR-1.1 | P0 | 3 | M2 | 8.1, 8.4 | `packages/core-domain/test/asset-registry.spec.ts` | DONE |
| US-1.2 | Acquisition lot with cost basis | 1 | FR-1.2 | P0 | 3 | M2 | 1.1 | `packages/core-domain/test/acquisition-lot.spec.ts` | DONE |
| US-1.3 | FIFO partial/complete exit | 1 | FR-1.2 | P0 | 5 | M2 | 1.2 | `packages/core-domain/test/fifo-allocation.spec.ts` | DONE |
| US-1.4 | Foreign lots, dual-currency basis | 1 | FR-1.1 | P0 | 8 | M2 | 1.3, 2.4, 2.5 | `packages/core-domain/test/foreign-equity.spec.ts` | DONE |
| US-1.5 | Dividend & interest with withholding | 1 | FR-1.2 | P0 | 5 | M2 | 1.4, 2.4 | `packages/core-domain/test/income-events.spec.ts` | DONE |
| US-1.6 | Corporate actions | 1 | FR-1.2 | P1 | 5 | M2 | 1.3 | `packages/core-domain/test/corporate-actions.spec.ts` | DONE |
| US-1.7 | Mutual fund holdings & NAV | 1 | FR-1.1 | P0 | 5 | M2 | 1.2 | `packages/core-domain/test/mutual-fund.spec.ts` | DONE |
| US-1.8 | EPF/VPF/NPS/PPF/Gratuity | 1 | FR-1.1 | P0 | 8 | M2 | 1.1 | `packages/core-domain/test/statutory-schemes.spec.ts` | DONE |
| US-1.9 | Fixed & recurring deposits | 1 | FR-1.1 | P0 | 3 | M2 | 1.1 | `packages/core-domain/test/deposits.spec.ts` | DONE |
| US-1.10 | Alternative & private assets | 1 | FR-1.1 | P1 | 5 | M2 | 1.1 | `packages/core-domain/test/alternative-assets.spec.ts` | DONE |
| US-1.11 | Hand loans with interest accrual | 1 | FR-1.1 | P0 | 5 | M2 | 1.1, 7.1 | `packages/core-domain/test/hand-loans.spec.ts` | DONE |
| US-1.12 | Chit / family savings schemes | 1 | FR-1.1 | P1 | 3 | M2 | 1.1 | `packages/core-domain/test/chit-schemes.spec.ts` | DONE |
| US-1.13 | Cash in hand & bank balances | 1 | FR-1.1 | P0 | 2 | M2 | 1.1 | `packages/core-domain/test/cash-holdings.spec.ts` | DONE |
| US-1.14 | Liabilities ledger | 1 | FR-6.2 | P0 | 3 | M2 | 1.1 | `packages/core-domain/test/liabilities.spec.ts` | DONE |
| US-1.15 | Portfolio valuation engine | 1 | NFR-2 | P0 | 8 | M2 | 1.4–1.14, 2.5 | `packages/core-domain/test/valuation-engine.spec.ts`, `tests/functional/perf/valuation-budget.bench.ts` | DONE |
| US-2.1 | FX rate store with provenance | 2 | FR-2.1 | P0 | 3 | M2 (pulled fwd) | 8.3 | `packages/fx-itbr/test/rate-store.spec.ts` | DONE |
| US-2.2 | SBI ITBR ingestion pipeline | 2 | FR-2.1 | P0 | 5 | M3 | 2.1, 8.10 | `packages/fx-itbr/test/sbi-ingestion.spec.ts` | TESTS_RED |
| US-2.3 | Fallback hierarchy resolver | 2 | FR-2.1 | P0 | 5 | M2 (pulled fwd) | 2.1 | `packages/fx-itbr/test/fallback-chain.spec.ts` | DONE |
| US-2.4 | Rule 115 resolver | 2 | FR-2.1 | P0 | 5 | M2 (pulled fwd) | 2.3 | `packages/fx-itbr/test/rule-115.spec.ts` | DONE |
| US-2.5 | Dual-rate conversion service | 2 | ADR-003 | P0 | 5 | M2 (pulled fwd) | 2.4 | `packages/fx-itbr/test/dual-rate-conversion.spec.ts` | DONE |
| US-2.6 | Retro rate finalisation | 2 | FR-2.1 | P1 | 8 | M3 | 2.5, 3.1 | `packages/fx-itbr/test/rate-amendment.spec.ts` | TESTS_RED |
| US-3.1 | Immutable content-addressed snapshot | 3 | FR-3.1 | P0 | 5 | M4 | 1.15 | `packages/snapshot/test/immutability.spec.ts` | TESTS_RED |
| US-3.2 | 31-Mar domestic auto snapshot | 3 | FR-3.1 | P0 | 5 | M4 | 3.1 | `packages/snapshot/test/compliance-scheduler.spec.ts` | TESTS_RED |
| US-3.3 | 31-Dec foreign auto snapshot | 3 | FR-3.1 | P0 | 3 | M4 | 3.1 | `packages/snapshot/test/compliance-scheduler.spec.ts` | TESTS_RED |
| US-3.4 | Custom arbitrary-date snapshot | 3 | FR-3.1 | P0 | 5 | M4 | 3.1 | `packages/snapshot/test/custom-snapshot.spec.ts` | TESTS_RED |
| US-3.5 | Snapshot ↔ snapshot comparison | 3 | FR-3.1 | P0 | 5 | M4 | 3.4 | `packages/snapshot/test/comparison-engine.spec.ts` | TESTS_RED |
| US-3.6 | Snapshot ↔ live comparison | 3 | FR-3.1 | P0 | 3 | M4 | 3.5 | `tests/functional/snapshot/live-vs-historical.spec.ts` | TESTS_RED |
| US-3.7 | Allocation shift & movement buckets | 3 | FR-3.1 | P0 | 5 | M4 | 3.5 | `packages/snapshot/test/allocation-shift.spec.ts` | TESTS_RED |
| US-3.8 | XIRR / CAGR / absolute return | 3 | FR-3.1 | P0 | 5 | M4 | 3.5 | `packages/snapshot/test/returns-xirr.spec.ts` | TESTS_RED |
| US-5.2 | Versioned tax rule table | 5 | FR-5.1 | P0 | 5 | M5 | 5.1 | `packages/tax-engine/test/rule-table.spec.ts` | TESTS_RED |
| US-5.3 | Form 16 parser & manual income | 5 | FR-5.1 | P0 | 8 | M5 | 5.2, 7.1 | `packages/tax-engine/test/form16-parser.spec.ts` | TESTS_RED |
| US-5.4 | Old vs New regime slabs | 5 | FR-5.1 | P0 | 8 | M5 | 5.3 | `packages/tax-engine/test/regime-comparison.spec.ts` | TESTS_RED |
| US-5.5 | Surcharge, marginal relief, cess | 5 | FR-5.1 | P0 | 8 | M5 | 5.4 | `packages/tax-engine/test/surcharge-relief.spec.ts` | TESTS_RED |
| US-5.6 | HNI classification | 5 | FR-5.1 | P0 | 3 | M5 | 5.5, 1.15 | `packages/tax-engine/test/hni-classification.spec.ts` | TESTS_RED |
| US-5.7 | Capital gains classifier | 5 | FR-5.2 | P0 | 5 | M5 | 5.2, 1.3 | `packages/tax-engine/test/cg-classifier.spec.ts` | TESTS_RED |
| US-5.8 | CG computation, exemption, grandfathering | 5 | FR-5.2 | P0 | 13 | M5 | 5.7, 2.5 | `packages/tax-engine/test/capital-gains.spec.ts` | TESTS_RED |
| US-5.9 | Other-sources income aggregation | 5 | FR-5.3 | P0 | 3 | M5 | 1.11, 1.9, 1.5 | `packages/tax-engine/test/other-sources.spec.ts` | TESTS_RED |
| US-5.10 | Quarterly advance tax engine | 5 | FR-5.3 | P0 | 13 | M5 | 5.8, 5.9, 5.5 | `packages/tax-engine/test/advance-tax.spec.ts`, `tests/functional/tax/advance-tax-q3.spec.ts` | TESTS_RED |
| US-5.11 | Foreign tax credit / DTAA | 5 | FR-5.1 | P1 | 8 | M5 | 5.10, 1.5 | `packages/tax-engine/test/foreign-tax-credit.spec.ts` | TESTS_RED |
| US-5.12 | Tax computation trace | 5 | FR-5.1 | P1 | 5 | M5 | 5.10 | `packages/tax-engine/test/computation-trace.spec.ts` | TESTS_RED |
| US-4.1 | Ingestion pipeline framework | 4 | FR-4.1 | P0 | 8 | M6 | 8.3 | `packages/ingestion/test/pipeline.spec.ts` | TESTS_RED |
| US-4.2 | CAMS / KFintech CAS PDF parser | 4 | FR-4.1 | P0 | 13 | M6 | 4.1, 7.1 | `packages/ingestion/test/cams-cas-parser.spec.ts` | TESTS_RED |
| US-4.3 | Zerodha XLSX + CSV parser | 4 | FR-4.1 | P0 | 8 | M6 | 4.1, 1.3 | `packages/ingestion/test/zerodha-parser.spec.ts` | TESTS_RED |
| US-4.4 | Vested CSV parser | 4 | FR-4.1 | P0 | 8 | M6 | 4.1, 1.4 | `packages/ingestion/test/vested-parser.spec.ts` | TESTS_RED |
| US-4.5 | E*TRADE parser | 4 | FR-4.1 | P0 | 8 | M6 | 4.1, 1.4 | `packages/ingestion/test/etrade-parser.spec.ts` | TESTS_RED |
| US-4.6 | Standardised CSV templates | 4 | FR-4.1 | P0 | 5 | M6 | 4.1 | `packages/ingestion/test/csv-templates.spec.ts` | TESTS_RED |
| US-4.7 | Idempotent re-import | 4 | FR-4.1 | P0 | 5 | M6 | 4.1 | `packages/ingestion/test/idempotency.spec.ts` | TESTS_RED |
| US-4.8 | Row-level error reporting | 4 | FR-4.1 | P1 | 3 | M6 | 4.1 | `packages/ingestion/test/error-reporting.spec.ts` | TESTS_RED |
| US-7.1 | Regex PII masking rules | 7 | FR-7.2 | P0 | 8 | M1 (pulled fwd) | 8.1 | `packages/pii-masker/test/regex-rules.spec.ts` | DONE |
| US-7.2 | NER name masking | 7 | FR-7.2 | P0 | 8 | M7 | 7.1 | `packages/pii-masker/test/ner-names.spec.ts` | TESTS_RED |
| US-7.3 | Full masking pipeline | 7 | FR-7.1 | P0 | 5 | M2 (pulled fwd) | 7.2 | `packages/pii-masker/test/masking-pipeline.spec.ts` | DONE |
| US-7.4 | Fail-closed egress guard | 7 | FR-7.1 | P0 | 5 | M7 | 7.3 | `packages/pii-masker/test/egress-guard.spec.ts` | TESTS_RED |
| US-7.5 | Deterministic pseudonymisation | 7 | FR-7.2 | P1 | 5 | M7 | 7.3 | `packages/pii-masker/test/pseudonymiser.spec.ts` | TESTS_RED |
| US-8.5 | Application shell UI | 8 | §3 | P0 | 13 | M8 | 8.3, 1.15 | `tests/e2e/app-shell.spec.ts` | TESTS_RED |
| US-8.6 | Headless CLI runner | 8 | §4.3 | P1 | 5 | M8 | 8.3 | `tests/functional/cli/commands.spec.ts` | TESTS_RED |
| US-8.7 | Performance budget harness | 8 | NFR-2 | P0 | 5 | M8 | 1.15, 3.5 | `tests/functional/perf/budgets.bench.ts` | TESTS_RED |
| US-8.8 | Backup / restore / export | 8 | NFR-1 | P1 | 5 | M8 | 8.2 | `tests/functional/platform/backup-restore.spec.ts` | TESTS_RED |
| US-8.11 | Backend API service | 8 | FR-8.1 | P0 | 8 | M8 | 8.3, 8.9 | `tests/functional/api/routes.spec.ts` | TESTS_RED |
| US-9.1 | Backend container image | 9 | FR-8.1 | P0 | 8 | M9 (skeleton M1) | 8.11 | `tests/container/api-image.spec.ts` | TESTS_RED |
| US-9.2 | Frontend container image | 9 | FR-8.1 | P0 | 8 | M9 | 8.5, 9.1 | `tests/container/web-image.spec.ts` | TESTS_RED |
| US-9.3 | Compose stack orchestration | 9 | FR-8.1 | P0 | 8 | M9 (skeleton M1) | 9.1, 9.2 | `tests/container/compose-stack.spec.ts` | TESTS_RED |
| US-9.4 | Host bind-mount persistence | 9 | FR-8.2 | P0 | 8 | M9 | 9.3, 8.2 | `tests/container/host-persistence.spec.ts` | TESTS_RED |
| US-9.5 | Host UID/GID ownership mapping | 9 | FR-8.3 | P0 | 5 | M9 | 9.4 | `tests/container/ownership.spec.ts` | TESTS_RED |
| US-9.6 | Secret handling & image hygiene | 9 | FR-8.3 | P0 | 5 | M9 | 9.1 | `tests/container/image-hygiene.spec.ts` | TESTS_RED |
| US-9.7 | In-container budgets & E2E | 9 | NFR-2, NFR-4 | P0 | 5 | M9 | 9.3, 8.7 | `tests/container/perf-in-container.spec.ts`, `tests/e2e/*` | TESTS_RED |
| US-9.8 | Cross-platform & operator docs | 9 | NFR-4 | P1 | 3 | M9 | 9.5, 8.8 | `tests/container/cross-platform.spec.ts` | TESTS_RED |
| US-6.1 | Peak value computation | 6 | FR-6.1 | P2 | 8 | M10 | 3.4, 2.5 | `packages/compliance/test/peak-value.spec.ts` | TESTS_RED |
| US-6.2 | Schedule FA Table A3 | 6 | FR-6.1 | P2 | 13 | M10 | 6.1 | `packages/compliance/test/schedule-fa-a3.spec.ts` | TESTS_RED |
| US-6.3 | Schedule FA Table D | 6 | FR-6.1 | P2 | 5 | M10 | 6.1 | `packages/compliance/test/schedule-fa-d.spec.ts` | TESTS_RED |
| US-6.4 | Schedule AL generator | 6 | FR-6.2 | P2 | 8 | M10 | 5.6, 1.14, 3.2 | `packages/compliance/test/schedule-al.spec.ts` | TESTS_RED |
| US-6.5 | ITR-ready JSON/CSV export | 6 | FR-6.1 | P2 | 5 | M10 | 6.2, 6.4 | `packages/compliance/test/itr-export.spec.ts` | TESTS_RED |

**Totals:** 80 stories · 460 points · Phase 1 (M0–M9) = 72 stories / 421 pts (of which EPIC-9 = 8 stories /
50 pts) · Phase 2 = 5 stories / 39 pts (EPIC-6) + backlog.

---

## 8. Test Strategy

| Layer | Tool | Scope | Runs against |
|---|---|---|---|
| **Unit** | Vitest, colocated in `packages/*/test/` | One domain package, ports stubbed. Every Gherkin scenario in §5 has a `describe`/`it` named after it. | Pure functions, injected `Clock`/`IdGenerator` |
| **Property** | `fast-check` under Vitest | FIFO invariants, Money arithmetic, masking idempotence | Domain packages |
| **Functional** | Vitest, `tests/functional/` | Cross-package use cases through `app-services`, real SQLite in a temp dir, fixture files, network hard-blocked | Whole system minus UI |
| **Benchmark** | Vitest `bench` | NFR-2 budgets, fails the build on regression | `core-domain`, `snapshot` |
| **Container** | Vitest, `tests/container/` (tag `@container`) | FR-8 acceptance: clean-host bring-up, bind-mount persistence across `down`/rebuild, non-root, read-only FS, image hygiene, in-container budgets | Real `docker compose` stack |
| **E2E** | Playwright, `tests/e2e/` | User journeys: unlock → import → snapshot → compare → advance tax | The **containerized** stack (base URL = compose web port) |

**Rules:**
- No test issues a network request. `EgressGateway` is stubbed and a global `fetch` trap fails any test that tries.
- Every test that touches money asserts exact `Money` equality, never `toBeCloseTo` on rupees.
- Every test that touches dates injects a fixed `Clock`; `Date.now()` in test bodies fails lint.
- Fixtures are synthetic. **No real PAN, Aadhaar, folio number or account number ever enters the repo** — fixture generators produce structurally valid but non-issued values.
- Test names carry the story ID (`US-5.10`) so the tracker is mechanically verifiable.
- Container tests are tagged `@container` and excluded from the fast unit run; they require a Docker
  daemon and each provisions its own throwaway host data directory under the OS temp path, asserting on
  the **host-side** file after the container writes it.

---

## 9. Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|-----------|
| R1 | SBI publishes ITBR sheets in an unstable format (PDF layout drift) | FX engine silently wrong | Parser asserts a structural fingerprint; layout change fails the ingest rather than producing rates. Fallback chain covers the gap. |
| R2 | CAMS CAS PDF layout varies by generation date and RTA | Import failures | Multiple layout adapters selected by fingerprint; unrecognised layout falls back to the CSV template path rather than guessing. |
| R3 | Indian tax rules change mid-build | Rework across the tax engine | ADR-005 rule tables; engine code carries no rates. New FY = new JSON file. |
| R4 | Rule 115 vs trade-date ambiguity (ADR-003) is challenged by a CA | Tax output disputed | Both values stored and shown with provenance; the computation trace (US-5.12) names the rule applied for every figure. |
| R5 | NER name masking has false negatives on Indian names | PII leak to LLM | ADR-007 fail-closed guard is the backstop; guard rescans post-mask and aborts. Regex layer catches structured PII independently of NER. |
| R6 | Performance budget missed on 1,000+ lots with per-day FX lookups | NFR-2 breach | Rate cache keyed by (currency, date); valuation batches lookups. Benchmark in CI from M2 so regressions surface immediately. |
| R7 | Grandfathering FMV data unavailable (OQ-4) | LTCG overstated for pre-2018 holdings | Manual per-lot entry; engine flags affected lots as `grandfatheringDataMissing` rather than assuming cost. |
| R8 | Non-root container + bind-mounted SQLite hits UID/permission problems, differently on Linux vs macOS vs WSL2 | Stack unusable on some hosts; discovered late | Walking-skeleton container at M1 (see M9 sequencing note), configurable `PORTTRACK_UID/GID` (US-9.5), entrypoint pre-flight that fails fast with the exact `chown` remediation. |
| R9 | `better-sqlite3` is a native module — build must match the container's libc (glibc vs musl) | Image build breaks or crashes at runtime | Pin the runtime base to a glibc image (`node:22-bookworm-slim`), rebuild the native module in the builder stage against that exact base, and assert it loads in a container smoke test. |
| R10 | SQLite over a bind mount on macOS/Windows can have fsync/locking quirks | Corruption risk under concurrent writes | Single-writer API process (no multi-replica), WAL mode with `synchronous=FULL`, and an integrity-check assertion in the persistence round-trip test. Documented as a single-instance deployment. |
| R11 | Containerizing tempts a move of PII masking to the backend | Unmasked PII crosses the wire — defeats FR-7 | ADR-013 plus a static test (US-9.2) asserting `apps/api` never imports the masker's masking entry point. |

---

## 10. Execution Order & Current State

1. ✅ **Architecture** — [`ARCHITECTURE_portrack.md`](./ARCHITECTURE_portrack.md): C4 context/container/
   component views, 7 data-flow sequence diagrams, trust boundaries, deployment view. All 12 Mermaid
   diagrams parse-verified.
2. ✅ **Tests first (M0)** — acceptance tests for every Gherkin scenario in §5, written against
   contract-only interfaces. **All 80 tracker rows are `TESTS_RED`.**
3. ⬜ **M1 → M9** implementation, turning tests green milestone by milestone (walking-skeleton container
   at M1, full containerization at M9).
4. ⬜ **M10** Phase 2 compliance exports.

### M0 result (2026-08-02)

All acceptance tests written first against contract-only interfaces; all 80 tracker rows reached
`TESTS_RED`.

### M1 result (2026-08-02) — COMPLETE

```
pnpm test        463 tests · 125 passing · 338 failing · 0 skipped
pnpm typecheck   clean
pnpm lint        clean
```

`DONE`: US-8.1, US-8.2, US-8.3, US-8.4, US-8.9, US-8.10, US-5.1, US-7.1 (8 stories, 41 pts).

Fully green packages: `shared-kernel` (36), `persistence` (30), `platform` (17). The remaining 338
failures are unimplemented stories reporting `NotImplementedError ... (US-x.y)`, exactly as intended.

**Plan corrections forced by implementation:**

| # | Finding | Resolution |
|---|---|---|
| 1 | **AES-256-GCM is unavailable** for whole-file SQLite encryption. The original NFR-1 wording could not be implemented as written. | ADR-015; NFR-1 amended to page-level AES-256-CBC + HMAC-SHA512. Evidence table in §0. |
| 2 | **A lightweight open probe does not detect tampering** — a tampered vault opens and returns data. Only `quick_check`/`integrity_check` walk every page. | `Vault.unlock` runs `quick_check` and refuses a vault that fails it. Without this the tamper-detection AC passes while the property does not hold. |
| 3 | **US-8.9 (M1) depended on US-7.1 (M7)** — a logger cannot scrub PII without the masking rules. | US-7.1 pulled forward into M1. The dependency graph already required it; the milestone assignment was wrong. |
| 4 | **No workspace package declared its dependencies.** Resolution worked only via vitest aliases and tsconfig `paths`; node resolution failed, so ESLint saw every cross-package import as `any` (965 spurious errors) — and container builds would have failed the same way. | Dependencies generated from actual imports for all 12 packages and 3 apps; `tests/test-kit` promoted to a real workspace package. |
| 5 | **`platform` package had no home in the layout** — the logger and EgressGateway are infrastructure every layer touches but no domain package may import. | Added `packages/platform`; layout and architecture updated. |
| 6 | Money tests sat in the persistence package; US-5.2 rule-table tests blocked the M1 calendar file from going green. | Relocated to `shared-kernel/test/money.spec.ts` and split into `rule-table.spec.ts`. |

### M2 result (2026-08-02) — COMPLETE

```
pnpm test        465 tests · 250 passing · 215 failing · 0 skipped
pnpm typecheck   clean
pnpm lint        clean
```

`DONE`: all fifteen EPIC-1 stories (US-1.1 … US-1.15), plus US-2.1/2.3/2.4/2.5 and US-7.3 pulled
forward. `core-domain` is fully green at 96/96.

**Cross-milestone dependency, resolved by pulling FX forward.** US-1.4 and US-1.5 carry the PRD's
flagship dual-rate acceptance criteria, and neither can pass without `Rule115Resolver` and
`DualRateConverter` — scheduled in M3. The dependency was always real; only the milestone assignment
was wrong. Same pattern as US-8.9 → US-7.1 in M1. **Remaining M3 work is genuinely independent**:
US-2.2 (SBI sheet parsing) and US-2.6 (retroactive amendment) stay red.

**Corrections forced by implementation:**

| # | Finding | Resolution |
|---|---|---|
| 1 | **Two acceptance criteria demanded incompatible day counts.** PRD FR-1 requires ₹400,000 on a full-year hand loan (year fraction exactly 1.0); US-1.11 requires zero interest on the start date. ACT/365 gives ₹398,904.11; inclusive ACT gives 1 day at the start. | **30/360** satisfies both (360/360 = 1.0; 0 at start). Recorded in `daycount.ts`. The derived partial-repayment figure was recomputed from ₹320,547.95 → ₹320,000; the original mixed ACT/365 for one leg with 30/360 for the other. |
| 2 | Three test expectations were arithmetic slips authored before implementation: FD ₹1,073,970.86 (1.018⁴ = 1.073967433), MF ₹107,943.06 (1,234.567 × 87.4321 = 107,940.785), and the hand-loan figure above. | Corrected to ₹1,073,967.43, ₹107,940.79 and ₹320,000, each with the arithmetic in a comment. |
| 3 | **The valuation engine had no price or FX input** — the NAV tests asserted a market value nothing supplied. | Added `PriceSource` and `FxSource` ports (OQ-1's stubbed adapter interface, now real). A missing FX rate throws `RateUnavailableError` rather than passing a foreign amount through as INR. |
| 4 | **Fallback ordering was wrong.** Exhausting SBI across all history before trying RBI would prefer a fortnight-old SBI rate over same-day RBI — the opposite of FR-2.1's bank-holiday rule. | Sources are now tried in priority order **per date**, then the date walks back. |
| 5 | EPF credited 11 monthly contributions for a full financial year. | Month counting made inclusive of the opening month: 1-Apr → 31-Mar is twelve. |
| 6 | `MaskingPipeline.maskPayload` masked free text only, so `borrowerName` survived — regex cannot recognise a person's name. | Structured payloads are masked by **field semantics**; NER (US-7.2) is reserved for free text, where that is the only available signal. |
| 7 | The `no-restricted-globals: Date` layering rule banned deterministic calendar arithmetic, not just ambient time. | Narrowed to `Date.now()` and zero-argument `new Date()` — the actual non-deterministic surface. |
| 8 | Test-kit lots defaulted to INR charges even on USD lots, so foreign cost basis threw a currency mismatch. | Charges now default to the lot's own currency. |

### Test inventory

| Suite | Location | Tests | State |
|---|---|---|---|
| Unit (domain packages) | `packages/*/test/` | 396 | 232 green (shared-kernel, core-domain, persistence, platform, most of fx-itbr and pii-masker) |
| Functional (through `app-services`) | `tests/functional/` | 69 | 18 green (architecture guards) |
| Container (FR-8) | `tests/container/` | 37 | red — awaits `compose.yaml` |
| E2E (Playwright) | `tests/e2e/` | 11 | red — awaits the UI |
| Benchmarks (NFR-2) | `tests/functional/perf/` | 2 | red |

Tracker rows move `TESTS_RED → WIP → REVIEW → DONE` per story from here.
