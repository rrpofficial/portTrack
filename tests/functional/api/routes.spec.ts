/**
 * US-8.11 — Backend API service (PRD FR-8.1)
 *
 * Exercises the Fastify app in-process via `inject` — no listening socket, so the
 * hermetic-network guarantee still holds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { buildApp } from '../../../apps/api/src/app.js';
import { expectNoPii } from '@porttrack/test-kit';

const ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Built per test rather than in a `beforeAll`: a throwing hook marks the whole
 * file SKIPPED, which hides red tests behind a green-looking count.
 */
/**
 * One throwaway directory per run. A fixed path let a vault from an EARLIER run
 * survive — created with a different passphrase — so unlock failed for reasons
 * that had nothing to do with the code under test.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'porttrack-api-'));
const app = () => buildApp({ dataDir: DATA_DIR });

describe('US-8.11 Scenario: API exposes the use cases the SPA needs', () => {
  it.each([
    ['POST', '/api/vault/unlock'],
    ['GET', '/api/portfolio/valuation'],
    ['POST', '/api/snapshots'],
    ['GET', '/api/snapshots/DOM_31MAR2026/compare'],
    ['POST', '/api/imports'],
    ['GET', '/api/tax/advance'],
  ])('routes %s %s', async (method, url) => {
    const response = await (await app()).inject({ method: method as 'GET' | 'POST', url });
    expect(response.statusCode).not.toBe(404);
  });

  it('returns JSON validated against the shared contract schema', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/api/health/live' });
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(() => JSON.parse(response.body)).not.toThrow();
  });
});

describe('US-8.11 Scenario: Health endpoints distinguish liveness from readiness', () => {
  it('returns 200 from /api/health/live when the process is up', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/api/health/live' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe('ok');
  });

  it('returns 503 VAULT_LOCKED from /api/health/ready while locked', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/api/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).reason).toBe('VAULT_LOCKED');
  });

  it('returns 200 from /api/health/ready once unlocked', async () => {
    const instance = await app();
    await instance.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { passphrase: 'correct horse battery staple' },
    });
    const response = await (await app()).inject({ method: 'GET', url: '/api/health/ready' });
    expect(response.statusCode).toBe(200);
  });
});

describe('US-8.11 Scenario: The API is a thin shell with no business logic', () => {
  it('has route handlers that import only app-services', () => {
    const routeFiles = globSync(`${ROOT}/apps/api/src/routes/**/*.ts`);
    expect(routeFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of routeFiles) {
      const source = readFileSync(file, 'utf8');
      if (
        /@porttrack\/(core-domain|tax-engine|fx-itbr|snapshot|ingestion|compliance|persistence)/.test(
          source,
        )
      ) {
        offenders.push(file.replace(ROOT, ''));
      }
    }
    expect(offenders, 'routes must delegate to app-services, not domain packages').toEqual([]);
  });
});

describe('US-8.11 Scenario: Vault passphrase is never logged or persisted (ADR-014)', () => {
  const PASSPHRASE = 'correct horse battery staple';

  it('does not echo the passphrase in the unlock response', async () => {
    const response = await (await app()).inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { passphrase: PASSPHRASE },
    });
    expect(response.body).not.toContain(PASSPHRASE);
  });

  it('does not echo the passphrase in a failed unlock error', async () => {
    const response = await (await app()).inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { passphrase: 'wrong' },
    });
    expect(response.body).not.toContain('wrong');
  });

  it('leaks no PII in any error response', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/api/portfolio/valuation' });
    expectNoPii(response.body);
  });
});
