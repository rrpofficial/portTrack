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
  GenerateSnapshotUC,
  ImportStatementUC,
  ValuePortfolioUC,
  VaultUC,
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

  /* ---------------------------------------------------------- snapshots */

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

  /* -------------------------------------------------------------- audit */

  app.get('/api/audit/egress', async () => ({ entries: await AuditUC.egressLog() }));

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
