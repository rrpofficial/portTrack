/** PII taxonomy and redaction tokens (PRD FR-7.2). */

export type PiiKind = 'PAN' | 'AADHAAR' | 'DEMAT_ACCOUNT' | 'NAME' | 'CONTACT' | 'TXN_ID';

export const REDACTION_TOKEN: Readonly<Record<PiiKind, string>> = {
  PAN: '[REDACTED_PAN]',
  AADHAAR: '[REDACTED_AADHAAR]',
  DEMAT_ACCOUNT: '[REDACTED_DEMAT_ACCOUNT]',
  NAME: '[REDACTED_NAME]',
  CONTACT: '[REDACTED_CONTACT]',
  TXN_ID: '[REDACTED_TXN_ID]',
};

export interface DetectedEntity {
  readonly kind: PiiKind;
  readonly start: number;
  readonly end: number;
}

export interface MaskResult {
  readonly masked: string;
  readonly entities: readonly DetectedEntity[];
}
