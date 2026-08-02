/**
 * apps/api — the backend HTTP shell that runs inside the `porttrack-api` container.
 *
 * Deliberately thin (US-8.11): every handler delegates to `app-services`. Route
 * files must not import a domain package — a functional test asserts this.
 *
 * ADR-013: this app imports the PII *verifier* only. The masking pipeline runs in
 * the browser bundle; relocating it here would put unmasked PII on the wire.
 *
 * IMPLEMENTATION STATUS: contract only (M0). Implemented at M8.
 */
import { notImplemented } from '@porttrack/shared-kernel';

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
  /** In-process request injection — no socket, so tests stay hermetic. */
  inject(options: InjectOptions): Promise<InjectResponse>;
  listen(options: { port: number; host: string }): Promise<void>;
  close(): Promise<void>;
}

export interface ApiConfig {
  /** In-container path backed by the host bind mount (ADR-012). */
  readonly dataDir: string;
  readonly port?: number;
}

export function buildApp(_config: ApiConfig): Promise<ApiApp> {
  return notImplemented('US-8.11', 'buildApp');
}
