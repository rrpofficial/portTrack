/**
 * apps/cli — headless runner for import / snapshot / tax (US-8.6).
 * Shares the same `app-services` layer as the API; no logic of its own.
 *
 * IMPLEMENTATION STATUS: contract only (M0). Implemented at M8.
 */
import { notImplemented } from '@porttrack/shared-kernel';

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  /** Machine-readable `{ code, message }` JSON on failure. */
  readonly stderr: string;
}

export function runCli(_argv: readonly string[]): Promise<CliResult> {
  return notImplemented('US-8.6', 'runCli');
}
