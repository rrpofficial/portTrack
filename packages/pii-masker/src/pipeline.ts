/**
 * Full masking pipeline (US-7.3, PRD FR-7.1).
 *
 * `maskPayload` walks arbitrary structures rather than relying on a field allow-list:
 * a portfolio payload nests differently depending on which use case produced it, and
 * a list of "sensitive field names" is exactly the thing that goes stale and leaks.
 * Keys are preserved; only string values are masked.
 */
import { detect, mask } from './regex-rules.js';
import { REDACTION_TOKEN, type DetectedEntity, type PiiKind } from './types.js';

/**
 * Field-name mapping for structured payloads. A person's name cannot be recognised
 * by pattern, but in JSON we know what a field MEANS — so structured data is masked
 * by key semantics and NER (US-7.2) is reserved for free text, where that is the
 * only signal available.
 */
const FIELD_KIND: readonly (readonly [RegExp, PiiKind])[] = [
  [/(^|_|\b)(borrower|investor|holder|nominee|customer|person|full)?_?name$/i, 'NAME'],
  [/^name$/i, 'NAME'],
  [/pan(_?(no|number))?$/i, 'PAN'],
  [/aadhaar|aadhar/i, 'AADHAAR'],
  [/(folio|dp_?id|client_?id|demat|account_?(no|number))/i, 'DEMAT_ACCOUNT'],
  [/(email|phone|mobile|address)/i, 'CONTACT'],
  [/(txn|transaction|order)_?id$/i, 'TXN_ID'],
];

function kindForField(key: string): PiiKind | undefined {
  for (const [pattern, kind] of FIELD_KIND) if (pattern.test(key)) return kind;
  return undefined;
}

export function maskText(text: string): string {
  return mask(text).masked;
}

export function maskPayload<T>(payload: T, seen = new WeakSet<object>()): T {
  if (typeof payload === 'string') return maskText(payload) as T;
  if (payload === null || typeof payload !== 'object') return payload;
  if (seen.has(payload)) return payload;
  seen.add(payload);

  if (Array.isArray(payload)) {
    return payload.map((item: unknown) => maskPayload(item, seen)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const kind = kindForField(key);
    out[key] =
      kind !== undefined && typeof value === 'string'
        ? REDACTION_TOKEN[kind]
        : maskPayload(value, seen);
  }
  return out as T;
}

export function detectEntities(text: string): readonly DetectedEntity[] {
  return detect(text);
}
