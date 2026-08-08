/**
 * HTTP routes (US-8.11).
 *
 * Every handler delegates to `app-services` and does nothing else — no
 * calculation, no rule, no interpretation. A functional test asserts that no
 * file in this directory imports a domain package, so the boundary is enforced
 * rather than merely intended.
 *
 * ADR-013: the PII *verifier* may be imported here, the masking pipeline may not.
 * Masking happens in the browser; relaying an unmasked payload is exactly what
 * this layer must be incapable of.
 */
import type { FastifyInstance } from 'fastify';
import {
  AuditUC,
  CompareSnapshotsUC,
  ComputeAdvanceTaxUC,
  GenerateComplianceUC,
  GenerateSnapshotUC,
  ImportStatementUC,
  LedgerUC,
  ListSnapshotsUC,
  ReferenceUC,
  TemplateUC,
  ValuePortfolioUC,
  VaultUC,
  hasIncomeProfile,
  incomeProfileOf,
  saveIncomeProfile,
} from '@porttrack/app-services';
import { PiiVerifier } from '@porttrack/pii-masker';

interface UnlockBody {
  readonly passphrase?: string;
}

const failure = (code: string, message: string) => ({ error: { code, message } });

export function registerRoutes(app: FastifyInstance): void {
  /* ------------------------------------------------------------- health */

  // Liveness answers "is the process up?" and gates container restarts.
  app.get('/api/health/live', () => ({ status: 'ok' }));

  // Readiness answers "can it serve?" — a locked vault is up but not usable,
  // and conflating the two would have the orchestrator restart a healthy process.
  app.get('/api/health/ready', (_request, reply) => {
    if (!VaultUC.isUnlocked()) {
      return reply.code(503).send({ status: 'unavailable', reason: 'VAULT_LOCKED' });
    }
    return reply.send({ status: 'ok' });
  });

  /* -------------------------------------------------------------- vault */

  app.post<{ Body: UnlockBody }>('/api/vault/unlock', async (request, reply) => {
    const passphrase = request.body.passphrase ?? '';
    const result = await VaultUC.unlock(passphrase);
    if (!result.ok) {
      // The passphrase never appears in the response, logged or otherwise.
      return reply.code(401).send(failure(result.error.code, 'unable to unlock vault'));
    }
    return reply.send({ unlocked: true });
  });

  app.post('/api/vault/lock', async (_request, reply) => {
    await VaultUC.lock();
    return reply.send({ unlocked: false });
  });

  /* ---------------------------------------------------------- portfolio */

  app.get('/api/portfolio/valuation', async (request, reply) => {
    const asOf = (request.query as { asOf?: string }).asOf ?? new Date().toISOString();
    const result = await ValuePortfolioUC.execute(asOf);
    return result.ok
      ? reply.send(result.value)
      : reply.code(409).send(failure(result.error.code, result.error.message));
  });

  /* ------------------------------------------------------------- ledger */

  app.get('/api/ledger/assets', async (_request, reply) => {
    const [assets, liabilities, exits] = await Promise.all([
      LedgerUC.assets(),
      LedgerUC.liabilities(),
      LedgerUC.exits(),
    ]);
    return reply.send({ assets, liabilities, exits });
  });

  /* ---------------------------------------------------------- snapshots */

  app.get('/api/snapshots', async (_request, reply) =>
    reply.send({ snapshots: await ListSnapshotsUC.execute() }),
  );

  app.post('/api/snapshots', async (request, reply) => {
    const asOf = (request.body as { asOf?: string } | undefined)?.asOf;
    const result =
      asOf === undefined
        ? await GenerateSnapshotUC.runScheduler(new Date().toISOString())
        : await GenerateSnapshotUC.custom(asOf);
    return result.ok
      ? reply.code(201).send(result.value)
      : reply.code(409).send(failure(result.error.code, result.error.message));
  });

  app.get<{ Params: { id: string } }>('/api/snapshots/:id/compare', async (request, reply) => {
    const target = (request.query as { target?: string }).target ?? 'live';
    const result =
      target === 'live'
        ? await CompareSnapshotsUC.snapshotToLive(request.params.id, new Date().toISOString())
        : await CompareSnapshotsUC.snapshotToSnapshot(request.params.id, target);
    return result.ok
      ? reply.send(result.value)
      : // 409, not 404: the request was routable and understood, the referenced
        // snapshot simply does not exist. Returning 404 would be ambiguous with
        // an unregistered route, for clients and for our own tests alike.
        reply.code(409).send(failure(result.error.code, result.error.message));
  });

  /* ---------------------------------------------------------- reference */

  // Ungated like the templates: which financial year it is does not depend on
  // anyone's vault, and the UI needs it to render its year pickers before unlock.
  app.get('/api/reference/periods', (_request, reply) => reply.send(ReferenceUC.periods()));

  /* ---------------------------------------------------------- templates */

  // Not gated on the vault: a user needs the blank template BEFORE they have
  // anything to put in it, and these files contain no data of theirs.
  app.get('/api/templates', (_request, reply) =>
    reply.send({ templates: TemplateUC.list() }),
  );

  app.get<{ Params: { name: string } }>('/api/templates/:name', (request, reply) => {
    // Both `Custom_Cash` and `Custom_Cash.csv` resolve: the download link uses
    // the bare name, but a user who types or shares the URL will include the
    // extension they saw on the file.
    const name = request.params.name.replace(/\.csv$/i, '');
    const csv = TemplateUC.generate(name);
    if (csv.length === 0) {
      return reply.code(404).send(failure('UNKNOWN_TEMPLATE', 'no such template'));
    }
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}.csv"`)
      .send(csv);
  });

  /* ------------------------------------------------------------ imports */

  app.post('/api/imports', async (request, reply) => {
    const body = request.body as
      | { file?: string; fileName?: string; parser?: string; mode?: string; password?: string }
      | undefined;

    const result = await ImportStatementUC.execute({
      file: Buffer.from(body?.file ?? '', 'base64'),
      fileName: body?.fileName ?? 'upload',
      parser: (body?.parser ?? 'TEMPLATE') as Parameters<typeof ImportStatementUC.execute>[0]['parser'],
      mode: (body?.mode ?? 'STRICT') as 'STRICT' | 'LENIENT',
      ...(body?.password === undefined ? {} : { password: body.password }),
    });
    return result.ok
      ? reply.send(result.value)
      : reply.code(422).send(failure(result.error.code, result.error.message));
  });

  /* ---------------------------------------------------------------- tax */

  app.get('/api/tax/advance', async (request, reply) => {
    const query = request.query as { fy?: string; quarter?: string };
    const result = await ComputeAdvanceTaxUC.execute({
      financialYear: query.fy ?? '2025-26',
      quarter: (query.quarter ?? 'Q1') as 'Q1' | 'Q2' | 'Q3' | 'Q4',
    });
    return result.ok
      ? reply.send(result.value)
      : reply.code(409).send(failure(result.error.code, result.error.message));
  });

  app.get('/api/tax/regimes', async (request, reply) => {
    const fy = (request.query as { fy?: string }).fy ?? '2025-26';
    const result = await ComputeAdvanceTaxUC.compareRegimes(fy);
    return result.ok
      ? reply.send({ ...result.value, hasIncomeProfile: hasIncomeProfile() })
      : reply.code(409).send(failure(result.error.code, result.error.message));
  });

  app.get('/api/tax/income-profile', (_request, reply) =>
    // `present` is reported separately: a nil tax figure computed from a missing
    // Form 16 must not read as a computed answer of zero.
    reply.send({ present: hasIncomeProfile(), profile: incomeProfileOf() ?? null }),
  );

  app.post('/api/tax/income-profile', async (request, reply) => {
    const body = request.body as { profile?: unknown } | undefined;
    if (body?.profile === undefined || body.profile === null) {
      return reply.code(422).send(failure('INVALID_BODY', 'an income profile is required'));
    }
    const saved = await saveIncomeProfile(body.profile as Parameters<typeof saveIncomeProfile>[0]);
    return saved.ok
      ? reply.send({ present: true })
      : reply.code(409).send(failure(saved.error.code, saved.error.message));
  });

  /* --------------------------------------------------------- compliance */

  app.get('/api/compliance/schedule-fa', async (request, reply) => {
    const query = request.query as { cy?: string };
    // CALENDAR year — Schedule FA runs 1 Jan to 31 Dec, unlike everything else.
    const calendarYear = Number(query.cy ?? new Date().getUTCFullYear() - 1);
    const [a3, d] = await Promise.all([
      GenerateComplianceUC.scheduleFaA3(calendarYear),
      GenerateComplianceUC.scheduleFaD(calendarYear),
    ]);
    return reply.send({
      calendarYear,
      tableA3: a3.ok ? a3.value : null,
      tableA3Error: a3.ok ? null : { code: a3.error.code, message: a3.error.message },
      tableD: d.ok ? d.value : null,
      tableDError: d.ok ? null : { code: d.error.code, message: d.error.message },
    });
  });

  app.get('/api/compliance/schedule-al', async (request, reply) => {
    const fy = (request.query as { fy?: string }).fy ?? '2025-26';
    const result = await GenerateComplianceUC.scheduleAl(fy);
    return result.ok
      ? reply.send(result.value)
      : reply.code(409).send(failure(result.error.code, result.error.message));
  });

  /* -------------------------------------------------------------- audit */

  app.get('/api/audit/egress', async () => ({ entries: await AuditUC.egressLog() }));

  app.get('/api/audit/log', async () => ({ lines: await AuditUC.applicationLog() }));

  /* ---------------------------------------------------------------- ai */

  app.post('/api/ai/analyze', async (request, reply) => {
    const payload = (request.body as { payload?: string } | undefined)?.payload ?? '';
    // Second, independent gate (ADR-007). The browser masks; this refuses to
    // relay anything that still carries PII, so a bug in the SPA is not enough.
    const clean = PiiVerifier.assertClean(payload);
    if (!clean.ok) {
      return reply.code(422).send(failure(clean.error.code, 'payload still contains PII'));
    }
    return reply.code(501).send(failure('NOT_IMPLEMENTED', 'AI insight is a Phase 2 capability'));
  });
}
