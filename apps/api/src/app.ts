/**
 * apps/api — the backend HTTP shell that runs inside the `porttrack-api`
 * container (ADR-011).
 *
 * Deliberately thin: it opens the vault, registers routes and gets out of the
 * way. `inject` exposes in-process request handling so functional tests exercise
 * real routing without opening a socket, keeping the suite hermetic.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { Vault } from '@porttrack/persistence';
import { registerRoutes } from './routes/index.js';

export interface InjectOptions {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly payload?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface InjectResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface ApiApp {
  inject(options: InjectOptions): Promise<InjectResponse>;
  listen(options: { port: number; host: string }): Promise<void>;
  close(): Promise<void>;
}

export interface ApiConfig {
  /** In-container path backed by the host bind mount (ADR-012). */
  readonly dataDir: string;
  readonly port?: number;
}

export async function buildApp(config: ApiConfig): Promise<ApiApp> {
  const fastify: FastifyInstance = Fastify({ logger: false });

  /*
   * Last line of defence. A route that throws unexpectedly returned Fastify's
   * default 500 carrying the raw message — one such response read
   * `[DecimalError] Invalid argument: 1,00,000`, which exposes an internal
   * library and a user's amount while telling them nothing they can act on.
   *
   * The message is replaced, not the status: a 500 is genuinely a defect here
   * and must not be dressed up as a client error.
   */
  fastify.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    void reply.code(error.statusCode ?? 500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'portTrack could not complete that request. Nothing was changed.',
      },
    });
  });

  registerRoutes(fastify);
  await fastify.ready();

  // Opened, not unlocked: the passphrase arrives per session and the process
  // must be able to report itself live while still refusing to serve data.
  await Vault.open({ dataDir: config.dataDir, fileName: 'vault.db' });

  return {
    async inject(options) {
      const response = await fastify.inject({
        method: options.method,
        url: options.url,
        payload: options.payload as never,
        headers: options.headers as never,
      });
      return {
        statusCode: response.statusCode,
        body: response.body,
        headers: response.headers as Readonly<Record<string, string | string[] | undefined>>,
      };
    },
    async listen(options) {
      await fastify.listen(options);
    },
    async close() {
      await fastify.close();
      await Vault.close();
    },
  };
}
