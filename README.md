# portTrack

Global multi-asset portfolio tracking and Indian tax compliance for Indian tax residents —
local-first, privacy-first, containerized.

| Document | Purpose |
|---|---|
| [`Global_Portfolio_Tracker_PRD.md`](./Global_Portfolio_Tracker_PRD.md) | Product requirements (source of truth) |
| [`implementation_plan_portrack.md`](./implementation_plan_portrack.md) | ADRs, 80 user stories, acceptance criteria, DoD, milestone tracker |
| [`ARCHITECTURE_portrack.md`](./ARCHITECTURE_portrack.md) | C4 component views + 7 data-flow sequence diagrams |

## Current status — all milestones complete

```
552 unit + functional   552 passing   0 failing   0 skipped
 38 container (Docker)   38 passing   0 failing
typecheck  clean         lint  clean         docker compose up ✓
```

**Every one of the eleven packages is green**, and the containerised stack runs: `docker compose up`
on a host with only Docker brings up the API and SPA, with your encrypted database on your own disk.

M0–M10 are done: kernel, asset ledger, FX and dual-rate conversion, snapshots, tax engine, ingestion,
PII masking, API/UI/CLI, containers, and the Schedule FA/AL exports.

> ⚠ **Tax rates are PROVISIONAL.** Computation works; `assertFilingReady` refuses to emit any filing
> artifact until the rates are sourced from the Finance Act and marked `VERIFIED`. The dashboard
> shows a provisional banner wherever a tax figure appears. **This is the one thing standing between
> the product and real use.**

> ⚠ **Name masking over-masks by design**, and the egress guard cannot catch a name the detector
> never recognised — see `packages/pii-masker/src/verifier.ts`.

> ⚠ **The Playwright E2E suite is written but unrun** — it needs browser binaries, which the
> default-deny egress posture blocks. Eleven theme guard tests cover FR-9 from the outside instead.

## Running it

```bash
cp .env.example .env     # set PORTTRACK_DATA_DIR and your UID/GID
docker compose up
```

Then open <http://localhost:5173>. Nothing else is required — no Node, no pnpm, no toolchain.

### Where your data lives

`${PORTTRACK_DATA_DIR:-./data}/vault.db` **on your own disk**, bind-mounted into the container
(ADR-012). Deliberately not a Docker named volume: those live under `/var/lib/docker`, are owned by
root, are invisible to your backup tooling and vanish to `docker volume prune`.

```
data/
├── vault.db            encrypted database (AES-256-CBC + HMAC-SHA512, page level)
├── vault.db.meta.json  KDF salt and parameters — BACK THIS UP TOO
└── vault.db-wal/-shm   SQLite write-ahead log
```

> **Back up the whole directory, not just `vault.db`.** The salt lives in `vault.db.meta.json`. A
> backup of the database alone restores to a vault nobody can open — and you would only discover
> that when you needed it most. `pnpm` users get this right automatically via `Backup.backup`, which
> archives both.

Your data survives `docker compose down`, `docker compose build --no-cache`, container recreation and
Docker Engine upgrades. Verified by the container suite, not assumed.

### Operator reference

| Task | Command |
|---|---|
| First run | `cp .env.example .env && docker compose up` |
| Match file ownership to you | set `PORTTRACK_UID=$(id -u)` and `PORTTRACK_GID=$(id -g)` in `.env` |
| Change where data lives | set `PORTTRACK_DATA_DIR=/path/on/your/disk` |
| Back up | copy the whole data directory while the stack is stopped |
| Restore | copy it back, then `docker compose up` |
| Upgrade | `git pull && docker compose up --build` — data is untouched |
| Logs | `docker compose logs -f api` |
| Allow outbound (FX/NAV) | `docker compose -f compose.yaml -f compose.egress.yaml up` |

The API publishes **no** host port and sits on an isolated network with no route to the internet.
That is not the application policing itself — the network has no gateway, so a compromised dependency
inside the API cannot exfiltrate a vault even if it tries.

### Developing without containers

```bash
pnpm install
pnpm --filter @porttrack/app-web dev   # SPA on :5173, proxying /api
node apps/api/build.mjs && node apps/api/dist/server.mjs
```

## Commands

```bash
pnpm install
pnpm test              # unit + functional (hermetic, no network)
pnpm typecheck         # strict TS, currently clean
pnpm bench             # NFR-2 performance budgets
pnpm test:container    # FR-8 Docker acceptance — needs a Docker daemon
pnpm test:e2e          # Playwright against the containerized stack
```

## Running the stack (from M9)

```bash
cp .env.example .env          # set PORTTRACK_DATA_DIR, PORTTRACK_UID/GID
docker compose up
```

Your encrypted database lives on **your own disk** at `${PORTTRACK_DATA_DIR:-./data}/vault.db` via a
bind mount — not in a Docker-managed volume. It survives `docker compose down`, image rebuilds and
Docker upgrades, and you can back it up with ordinary host tools (ADR-012).

## Design commitments

- **Dual FX rate per foreign transaction** (ADR-003) — trade-date ITBR for valuation, Rule 115 rate
  for taxable income. Resolves the PRD's FR-1 vs FR-2 conflict; both are stored with provenance.
- **All money is `Decimal`** (ADR-002). No `number` arithmetic on currency, anywhere.
- **Tax rates are FY-keyed data** (ADR-005), never literals in engine code.
- **Snapshots are immutable and content-addressed** (ADR-006).
- **PII masking runs in the browser and fails closed** (ADR-007, ADR-013). Two independent guards;
  neither warns-and-continues.
- **Zero network egress by default** (ADR-010), through a single audited gateway.

## Repository layout

```
packages/   shared-kernel · core-domain · fx-itbr · tax-engine · snapshot
            ingestion · compliance · pii-masker · persistence · adapters-fx · app-services
apps/       api (Fastify) · web (React SPA) · cli
docker/     api.Dockerfile · web.Dockerfile · Caddyfile · entrypoint
tests/      functional · container · e2e · fixtures · test-kit
```

Domain packages are pure — no `fs`, no `fetch`, no ambient clock. Time and identity are injected
ports, which is what makes the tax engine deterministically testable across financial years.

## Test fixtures

All fixtures are synthetic. No real PAN, Aadhaar, folio or account number is in this repository; a
guard test enforces it. The encrypted CAMS CAS fixture is generated by
[`tests/fixtures/cams/generate-cas-fixture.mjs`](./tests/fixtures/cams/generate-cas-fixture.mjs),
a zero-dependency implementation of the PDF standard security handler.
