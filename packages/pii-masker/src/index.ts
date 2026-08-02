/**
 * pii-masker — zero-trust anonymisation. Runs in the BROWSER bundle (ADR-013).
 * The API imports only {@link PiiVerifier}, never {@link MaskingPipeline}.
 */
import { notImplemented, type Result } from '@porttrack/shared-kernel';
import { detect, mask } from './regex-rules.js';
import { maskPayload, maskText } from './pipeline.js';

export * from './types.js';
import type { DetectedEntity, MaskResult, PiiKind } from './types.js';

export interface RegexRulesOps {
  mask(text: string): MaskResult;
  detect(text: string): readonly DetectedEntity[];
}

export interface NerMaskerOps {
  /** Local, offline named-entity recognition. Persons masked, organisations preserved. */
  maskPersonNames(text: string): MaskResult;
}

export interface PseudonymiserOps {
  /** Stable within a session: same entity → same numbered token. */
  tokenise(text: string, entities: readonly DetectedEntity[]): MaskResult;
  reversalMap(): ReadonlyMap<string, string>;
  rehydrate(text: string): string;
}

export interface MaskingPipelineOps {
  maskText(text: string): string;
  /** Recursively masks every PII-bearing field at every nesting level. */
  maskPayload<T>(payload: T): T;
}

export interface PiiVerifierOps {
  /** Fail-closed (ADR-007): throws PiiLeakError on any residual PII. */
  assertClean(payload: string): Result<void>;
  scan(payload: string): readonly PiiKind[];
}

export const RegexRules: RegexRulesOps = { mask, detect };
export const NerMasker: NerMaskerOps = {
  maskPersonNames: () => notImplemented('US-7.2', 'NerMasker.maskPersonNames'),
};
export const Pseudonymiser: PseudonymiserOps = {
  tokenise: () => notImplemented('US-7.5', 'Pseudonymiser.tokenise'),
  reversalMap: () => notImplemented('US-7.5', 'Pseudonymiser.reversalMap'),
  rehydrate: () => notImplemented('US-7.5', 'Pseudonymiser.rehydrate'),
};
export const MaskingPipeline: MaskingPipelineOps = { maskText, maskPayload };
export const PiiVerifier: PiiVerifierOps = {
  assertClean: () => notImplemented('US-7.4', 'PiiVerifier.assertClean'),
  scan: () => notImplemented('US-7.4', 'PiiVerifier.scan'),
};
