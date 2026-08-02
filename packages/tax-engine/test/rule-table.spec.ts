/**
 * US-5.2 — Versioned tax rule table (ADR-005)
 *
 * Milestone M5. Split out of fy-calendar.spec.ts so the M1 calendar story can go
 * green independently of the FY rate data, which needs Finance Act verification.
 */
import { describe, it, expect } from 'vitest';
import { TaxRuleTable } from '@porttrack/tax-engine';
import { expectErr, expectOk } from '@porttrack/test-kit';

describe('US-5.2 versioned tax rule table (ADR-005)', () => {
  describe('Scenario: Rules are resolved by financial year', () => {
    it('returns the FY 2025-26 rule set for that year', () => {
      expect(expectOk(TaxRuleTable.rulesFor('2025-26')).financialYear).toBe('2025-26');
    });

    it('returns a different rule set for FY 2024-25', () => {
      expect(expectOk(TaxRuleTable.rulesFor('2024-25')).financialYear).toBe('2024-25');
    });
  });

  describe('Scenario: Missing rule set fails loudly', () => {
    it('fails with TAX_RULES_UNAVAILABLE for FY 2030-31', () => {
      expectErr(TaxRuleTable.rulesFor('2030-31'), 'TAX_RULES_UNAVAILABLE');
    });

    it('does not silently fall back to the most recent year', () => {
      const result = TaxRuleTable.rulesFor('2030-31');
      expect(result.ok).toBe(false);
    });
  });

  describe('ADR-005: rates live in data, not code', () => {
    it('exposes the ₹1.25 lakh LTCG exemption as rule data', () => {
      const rules = expectOk(TaxRuleTable.rulesFor('2025-26'));
      expect(Number(rules.ltcgExemptionLimit.amount)).toBe(125000);
    });

    it('exposes the HNI thresholds as rule data (ADR-004)', () => {
      const rules = expectOk(TaxRuleTable.rulesFor('2025-26'));
      expect(Number(rules.hniIncomeThreshold.amount)).toBe(5000000);
      expect(Number(rules.hniNetWorthThreshold.amount)).toBe(100000000);
    });

    it('exposes the 4% health and education cess as rule data', () => {
      expect(Number(expectOk(TaxRuleTable.rulesFor('2025-26')).cessPct)).toBe(4);
    });
  });
});
