/**
 * Person-name detection for free text (US-7.2, PRD FR-7.2).
 *
 * **This uses part-of-speech tagging, not the NER the plan assumed.** wink-nlp's
 * entity recogniser was measured against this exact use case and returned ZERO
 * person entities — for "Rajesh Sharma", for "Priya Menon", for any name tried.
 * Its POS tagger, by contrast, reliably marks both tokens `PROPN`. So names are
 * found as runs of proper nouns and filtered down, rather than asked for directly.
 *
 * **The bias is deliberately toward over-masking.** A false positive costs a
 * slightly less useful prompt; a false negative sends someone's name to a third
 * party. Those are not comparable, so anything proper-noun-shaped is masked unless
 * it is positively identifiable as an organisation, a ticker or a common term.
 *
 * ⚠ The fail-closed egress guard CANNOT catch a name this misses. A PAN has a
 * shape; a name does not. See the note on `PiiVerifier` — the guard re-runs this
 * same detector, which catches pipeline bugs but not blind spots in the detector
 * itself. That is why the bias above matters, and why structured payloads are
 * masked by field semantics instead of relying on this at all.
 */
/*
 * `out(its.value)` is wink-nlp's documented API shape, and the `its.*` helpers are
 * stateless — they never reference `this`. The unbound-method rule is therefore a
 * false positive throughout this file, disabled for this one rule only.
 */
/* eslint-disable @typescript-eslint/unbound-method */
import winkNLP, { type Document } from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import type { DetectedEntity } from './types.js';
import { REDACTION_TOKEN } from './types.js';

const nlp = winkNLP(model);
const { its } = nlp;

/** Tokens that mark a proper-noun run as an organisation rather than a person. */
const ORGANISATION_MARKERS = new Set(
  [
    'ltd', 'limited', 'llp', 'inc', 'plc', 'corp', 'corporation', 'company', 'co',
    'services', 'consultancy', 'consulting', 'technologies', 'technology', 'systems',
    'solutions', 'industries', 'enterprises', 'holdings', 'ventures', 'capital',
    'bank', 'fund', 'mutual', 'amc', 'trust', 'insurance', 'securities', 'broking',
    'motors', 'pharma', 'pharmaceuticals', 'labs', 'laboratories', 'steel', 'cement',
    'finance', 'financial', 'investments', 'asset', 'management', 'exchange',
  ],
);

/** Common proper-noun-shaped words that are not names. */
const SAFE_LEXICON = new Set(
  [
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'india', 'indian', 'rupee', 'rupees', 'sensex', 'nifty', 'bse', 'nse',
    'pan', 'aadhaar', 'dpid', 'folio', 'isin', 'sip', 'nav', 'ltcg', 'stcg',
  ],
);

/** All-caps short tokens read as tickers or acronyms, not names. */
const isTickerLike = (token: string): boolean => /^[A-Z0-9&.]{1,6}$/.test(token);

interface Run {
  readonly tokens: readonly string[];
  readonly start: number;
  readonly end: number;
}

function properNounRuns(doc: Document, text: string): Run[] {
  const values = doc.tokens().out(its.value);
  const runs: Run[] = [];

  let current: string[] = [];
  let cursor = 0;
  let runStart = -1;
  let runEnd = -1;

  const flush = (): void => {
    if (current.length > 0 && runStart >= 0) {
      runs.push({ tokens: [...current], start: runStart, end: runEnd });
    }
    current = [];
    runStart = -1;
  };

  doc.tokens().each((token, index) => {
    const value = values[index] ?? '';
    // Locate the token in the source so spans refer to the original string.
    const at = text.indexOf(value, cursor);
    const start = at < 0 ? cursor : at;
    const end = start + value.length;
    cursor = end;

    if (token.out(its.pos) === 'PROPN') {
      if (current.length === 0) runStart = start;
      current.push(value);
      runEnd = end;
    } else {
      flush();
    }
  });
  flush();

  return runs;
}

function isPerson(run: Run): boolean {
  const lowered = run.tokens.map((token) => token.toLowerCase());

  // Anything naming an organisation is preserved — masking a company name makes
  // the prompt useless without protecting anyone.
  if (lowered.some((token) => ORGANISATION_MARKERS.has(token))) return false;
  if (lowered.every((token) => SAFE_LEXICON.has(token))) return false;

  // A lone ticker or acronym is not a person; a lone ordinary proper noun might
  // be, and is masked because the cost of being wrong runs one way.
  if (run.tokens.length === 1) {
    const only = run.tokens[0] ?? '';
    if (isTickerLike(only)) return false;
    if (/\d/.test(only)) return false; // structured identifiers are the regex layer's job
  }
  return true;
}

export function detectPersonNames(text: string): readonly DetectedEntity[] {
  const doc = nlp.readDoc(text);
  return properNounRuns(doc, text)
    .filter(isPerson)
    .map((run) => ({ kind: 'NAME' as const, start: run.start, end: run.end }));
}

export function maskPersonNames(text: string): { masked: string; entities: readonly DetectedEntity[] } {
  const entities = detectPersonNames(text);
  let masked = '';
  let cursor = 0;
  for (const entity of entities) {
    masked += text.slice(cursor, entity.start) + REDACTION_TOKEN.NAME;
    cursor = entity.end;
  }
  masked += text.slice(cursor);
  return { masked, entities };
}
