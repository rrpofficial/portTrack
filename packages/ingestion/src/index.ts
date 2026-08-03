/**
 * ingestion — the pipeline and every statement parser. Pure: parsers take bytes
 * or text and return data; nothing here touches the filesystem or the network.
 */
import { parseCams } from './cams.js';
import {
  compareRealisedGains,
  parseEtrade,
  parseVested,
  parseZerodhaTradebook,
} from './brokers.js';
import { generateTemplate, listTemplates, parseTemplate, validateHeaders } from './templates.js';
import { naturalKey, partition } from './duplicates.js';
import { ingest } from './pipeline.js';

export * from './types.js';
export { TEMPLATES, type TemplateDefinition } from './templates.js';
export type { ParseOutcome } from './brokers.js';

/** US-4.1 — parse → validate → stage → reconcile → commit. */
export const Pipeline = { ingest };

/** US-4.2 — CAMS / KFintech consolidated account statements. */
export const CamsCasParser = { parse: parseCams };

/** US-4.3 — Zerodha tradebook and tax P&L. */
export const ZerodhaTradebookParser = {
  parse: (csv: string, fileName: string) => {
    const parsed = parseZerodhaTradebook(csv, fileName);
    return parsed.ok ? { ok: true as const, value: parsed.value.transactions } : parsed;
  },
};
export const ZerodhaTaxPnlParser = ZerodhaTradebookParser;
export const ReconciliationExceptions = { compareRealisedGains };

/** US-4.4 — Vested account activity. */
export const VestedParser = {
  parse: (csv: string, fileName: string) => {
    const parsed = parseVested(csv, fileName);
    return parsed.ok ? { ok: true as const, value: parsed.value.transactions } : parsed;
  },
};

/** US-4.5 — E*TRADE transaction history. */
export const EtradeParser = {
  parse: (csv: string, fileName: string) => {
    const parsed = parseEtrade(csv, fileName);
    return parsed.ok ? { ok: true as const, value: parsed.value.transactions } : parsed;
  },
};

/** US-4.6 — standardised CSV templates. */
export const TemplateParser = { parse: parseTemplate };
export const TemplateRegistry = {
  list: listTemplates,
  generate: generateTemplate,
  validateHeaders,
};

/** US-4.7 — idempotent re-import. */
export const DuplicateDetector = { naturalKey, partition };
