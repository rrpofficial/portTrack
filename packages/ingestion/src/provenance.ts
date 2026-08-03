/**
 * Provenance and opaque references (US-4.1).
 *
 * Folio and account numbers are PII (FR-7.2). They are therefore never carried
 * through the pipeline in the clear: a parser emits a deterministic opaque
 * reference instead, which is stable enough for duplicate detection while the raw
 * value stays in the encrypted vault. Deriving the reference by hash rather than
 * by masking keeps it collision-free without being reversible from the payload.
 */
import { createHash } from 'node:crypto';
import type { ParserName, Provenance } from './types.js';

export function folioRef(rawFolio: string): string {
  return `folio_${createHash('sha256').update(rawFolio.trim()).digest('hex').slice(0, 16)}`;
}

export function accountRef(rawAccount: string): string {
  return `acct_${createHash('sha256').update(rawAccount.trim()).digest('hex').slice(0, 16)}`;
}

export function provenanceFor(
  sourceFile: string,
  sourceRow: number,
  parserName: ParserName,
  importedAt: string,
): Provenance {
  return { sourceFile, sourceRow, parserName, importedAt };
}

/**
 * Import timestamps are derived from the file being imported, not the wall clock:
 * re-importing the same file must produce byte-identical records so duplicate
 * detection and the determinism test both hold.
 */
export function deterministicImportedAt(sourceFile: string): string {
  const digest = createHash('sha256').update(sourceFile).digest('hex').slice(0, 8);
  return `import:${digest}`;
}
