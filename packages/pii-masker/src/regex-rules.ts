/**
 * Regex-based PII detection and masking (US-7.1, PRD FR-7.2).
 *
 * Ordering is significant. Aadhaar and DP/demat IDs are both bare digit runs, so
 * the longer, more specific pattern must win; masking Aadhaar first would leave the
 * trailing digits of a 16-digit DP ID exposed. Rules are applied longest-match-first
 * over a single pass so no rule can re-match another rule's replacement token.
 *
 * Pure and offline — no network, no model, no I/O.
 */
import type { DetectedEntity, MaskResult, PiiKind } from './types.js';
import { REDACTION_TOKEN } from './types.js';

interface Rule {
  readonly kind: PiiKind;
  readonly pattern: RegExp;
  /** Higher wins when two rules match overlapping spans. */
  readonly specificity: number;
}

/**
 * Indian mobile numbers are 10 digits starting 6-9, optionally +91-prefixed.
 * Deliberately not matching bare 10-digit runs without a prefix or separator,
 * which would swallow quantities and prices.
 */
const RULES: readonly Rule[] = [
  // PAN: five letters, four digits, one letter.
  { kind: 'PAN', pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, specificity: 90 },

  // Demat/DP/Client IDs: 16 contiguous digits, or a CAMS-style folio "12345678/90".
  { kind: 'DEMAT_ACCOUNT', pattern: /\b\d{16}\b/g, specificity: 80 },
  { kind: 'DEMAT_ACCOUNT', pattern: /\b\d{6,10}\s*\/\s*\d{1,3}\b/g, specificity: 78 },

  // Transaction/order IDs: 15-digit broker order references.
  { kind: 'TXN_ID', pattern: /\b\d{15}\b/g, specificity: 75 },

  // Aadhaar: 12 digits starting 2-9, optionally space/hyphen grouped 4-4-4.
  { kind: 'AADHAAR', pattern: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, specificity: 70 },

  { kind: 'CONTACT', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, specificity: 60 },
  { kind: 'CONTACT', pattern: /(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, specificity: 55 },
  // Indian postal address tail: "... 560001" preceded by a locality phrase.
  {
    kind: 'CONTACT',
    pattern: /\b(?:Flat|Plot|House|No\.?|Door)\s*[\w/-]+,[^,\n]{0,60},[^,\n]{0,40}\s\d{6}\b/gi,
    specificity: 50,
  },
];

interface Span {
  start: number;
  end: number;
  kind: PiiKind;
  specificity: number;
}

/** Collects all matches, then discards any span overlapped by a more specific one. */
function collectSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        kind: rule.kind,
        specificity: rule.specificity,
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }

  spans.sort((a, b) => b.specificity - a.specificity || a.start - b.start);

  const kept: Span[] = [];
  for (const span of spans) {
    const overlaps = kept.some((k) => span.start < k.end && k.start < span.end);
    if (!overlaps) kept.push(span);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function detect(text: string): DetectedEntity[] {
  return collectSpans(text).map(({ kind, start, end }) => ({ kind, start, end }));
}

export function mask(text: string): MaskResult {
  const spans = collectSpans(text);
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start) + REDACTION_TOKEN[span.kind];
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { masked: out, entities: spans.map(({ kind, start, end }) => ({ kind, start, end })) };
}
