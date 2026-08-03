/**
 * Canonical serialisation and content hashing (US-3.1, ADR-006).
 *
 * A snapshot's identity is its content. That only works if serialisation is
 * canonical: `{a:1,b:2}` and `{b:2,a:1}` must produce the same bytes, or a
 * snapshot would appear to have diverged whenever an unrelated refactor changed
 * a property order. Keys are therefore sorted at every level.
 *
 * Money is already carried as a decimal string (ADR-002), so no float ever
 * reaches the hash — `0.1 + 0.2` cannot change a content hash here.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalise);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    // Undefined properties are omitted rather than serialised, so an optional
    // field that is absent hashes the same as one explicitly set to undefined.
    if (entry !== undefined) sorted[key] = canonicalise(entry);
  }
  return sorted;
}

export function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
