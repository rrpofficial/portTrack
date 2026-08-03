/**
 * Deterministic pseudonymisation (US-7.5, PRD FR-7.2).
 *
 * Replacing every name with the same `[REDACTED_NAME]` destroys the relationships
 * an analysis depends on — "A lent to B, then B repaid A" becomes unreadable.
 * Numbered tokens keep the structure while carrying no identity.
 *
 * The reversal map lives only in memory and is written only to the encrypted
 * vault. It is never part of a masked payload and never leaves the device: it is
 * precisely the thing that would turn an anonymised prompt back into PII.
 */
import type { DetectedEntity, MaskResult, PiiKind } from './types.js';

export class Pseudonymiser {
  private readonly forward = new Map<string, string>();
  private readonly reverse = new Map<string, string>();
  private readonly counters = new Map<PiiKind, number>();

  private tokenFor(kind: PiiKind, value: string): string {
    const key = `${kind}:${value.toLowerCase()}`;
    const existing = this.forward.get(key);
    if (existing !== undefined) return existing;

    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    const token = `[REDACTED_${kind}_${String(next)}]`;
    this.forward.set(key, token);
    this.reverse.set(token, value);
    return token;
  }

  /** Replaces each detected entity with a token stable across the whole session. */
  tokenise(text: string, entities: readonly DetectedEntity[]): MaskResult {
    const ordered = [...entities].sort((a, b) => a.start - b.start);
    let masked = '';
    let cursor = 0;

    for (const entity of ordered) {
      if (entity.start < cursor) continue; // overlapping match already consumed
      const value = text.slice(entity.start, entity.end);
      masked += text.slice(cursor, entity.start) + this.tokenFor(entity.kind, value);
      cursor = entity.end;
    }
    masked += text.slice(cursor);
    return { masked, entities: ordered };
  }

  /** Local-only. Never serialised into an outbound payload. */
  reversalMap(): ReadonlyMap<string, string> {
    return new Map(this.reverse);
  }

  /** Restores original values for display, after a response comes back. */
  rehydrate(text: string): string {
    let restored = text;
    for (const [token, value] of this.reverse) {
      restored = restored.split(token).join(value);
    }
    return restored;
  }

  reset(): void {
    this.forward.clear();
    this.reverse.clear();
    this.counters.clear();
  }
}

/** Process-wide session instance; single-tenant by design (ADR-011). */
export const sessionPseudonymiser = new Pseudonymiser();
