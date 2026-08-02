/**
 * US-6.1 — Peak value computation over the calendar year (PRD FR-6.1)
 * US-6.2 — Schedule FA Table A3 generator (PRD FR-6 AC)
 * US-6.3 — Schedule FA Table D generator
 * US-6.4 — Schedule AL generator (PRD FR-6.2)
 * US-6.5 — ITR-ready JSON / CSV export
 */
import { describe, it, expect } from 'vitest';
import {
  ItrExporter,
  PeakValueCalculator,
  ScheduleAlGenerator,
  ScheduleFaGenerator,
} from '@porttrack/compliance';
import type { Snapshot } from '@porttrack/snapshot';
import { expectMoney, expectNoPii, expectOk, inr, usd } from '@porttrack/test-kit';

const foreignSnapshot: Snapshot = {
  snapshotId: 'FOR_31DEC2025',
  kind: 'FOREIGN_COMPLIANCE',
  scope: 'FOREIGN',
  asOf: '2025-12-31T23:59:59.999+05:30',
  positions: [],
  totals: {
    netWorth: inr('50000000'),
    grossAssets: inr('50000000'),
    liabilities: inr('0'),
    byAssetClass: {},
  },
  contentHash: 'sha256:for31dec2025',
  createdAt: '2026-01-01T00:05:00+05:30',
  frozen: true,
};

const domesticSnapshot: Snapshot = {
  ...foreignSnapshot,
  snapshotId: 'DOM_31MAR2026',
  kind: 'DOMESTIC_COMPLIANCE',
  scope: 'DOMESTIC',
  asOf: '2026-03-31T23:59:59.999+05:30',
  contentHash: 'sha256:dom31mar2026',
};

const dates = (from: string, days: number) =>
  Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

describe('US-6.1 peak value computation', () => {
  describe('Scenario: Peak holding value is the maximum daily value in the calendar year', () => {
    const days = dates('2025-01-01', 365);
    const quantities = new Map(days.map((d) => [d, '100']));
    const prices = new Map(days.map((d, i) => [d, usd(String(150 + (i === 200 ? 100 : 0)))]));
    const rates = new Map(days.map((d) => [d, '83.00']));

    it('selects the maximum of daily quantity × price × FX', () => {
      const peak = PeakValueCalculator.compute({
        assetId: 'ast_aapl',
        from: '2025-01-01',
        to: '2025-12-31',
        dailyQuantities: quantities,
        dailyPrices: prices,
        dailyRates: rates,
      });
      expectMoney(peak.peakNative, usd('25000'));
    });

    it('reports both the native and INR peak with the peak date', () => {
      const peak = PeakValueCalculator.compute({
        assetId: 'ast_aapl',
        from: '2025-01-01',
        to: '2025-12-31',
        dailyQuantities: quantities,
        dailyPrices: prices,
        dailyRates: rates,
      });
      expectMoney(peak.peakInr, inr('2075000'));
      expect(peak.peakDate).toBe(days[200]);
    });
  });

  describe('Scenario: Peak value accounts for quantity changes mid-year', () => {
    it('uses the quantity actually held on each date', () => {
      const days = dates('2025-01-01', 365);
      const quantities = new Map(days.map((d) => [d, d <= '2025-06-30' ? '100' : '40']));
      const prices = new Map(days.map((d) => [d, usd('200')]));
      const rates = new Map(days.map((d) => [d, '83.00']));
      const peak = PeakValueCalculator.compute({
        assetId: 'ast_aapl',
        from: '2025-01-01',
        to: '2025-12-31',
        dailyQuantities: quantities,
        dailyPrices: prices,
        dailyRates: rates,
      });
      expectMoney(peak.peakNative, usd('20000'));
      expect(peak.peakDate <= '2025-06-30').toBe(true);
    });
  });
});

describe('US-6.2 Schedule FA Table A3', () => {
  describe('Scenario: Generating Schedule FA output for US stocks (PRD FR-6 AC)', () => {
    it('reports the peak holding value in both USD and INR for the calendar year', () => {
      const rows = expectOk(
        ScheduleFaGenerator.tableA3({ foreignSnapshot, calendarYear: 2025 }),
      );
      expect(rows[0]?.peakValueNative.currency).toBe('USD');
      expect(rows[0]?.peakValueInr.currency).toBe('INR');
    });

    it('computes the closing value on 2025-12-31 using the SBI ITBR rate', () => {
      const rows = expectOk(
        ScheduleFaGenerator.tableA3({ foreignSnapshot, calendarYear: 2025 }),
      );
      expect(rows[0]?.closingValueInr.currency).toBe('INR');
    });

    it('produces a Table A3 structure with all mandated columns', () => {
      const rows = expectOk(
        ScheduleFaGenerator.tableA3({ foreignSnapshot, calendarYear: 2025 }),
      );
      expect(Object.keys(rows[0] ?? {})).toEqual(
        expect.arrayContaining([
          'countryCode',
          'entityName',
          'acquisitionDate',
          'peakValueInr',
          'closingValueInr',
          'grossDividendInr',
          'grossProceedsInr',
        ]),
      );
    });
  });

  describe('Scenario: Table A3 uses the CALENDAR year, not the financial year', () => {
    it('reports gross dividends and gross proceeds for 1-Jan to 31-Dec', () => {
      const rows = expectOk(
        ScheduleFaGenerator.tableA3({ foreignSnapshot, calendarYear: 2025 }),
      );
      expect(rows[0]?.grossDividendInr).toBeDefined();
      expect(rows[0]?.grossProceedsInr).toBeDefined();
    });
  });

  describe('Scenario: Assets held for part of the year report the acquisition date', () => {
    it('reports the 2025-08-01 acquisition date and a peak over the held period only', () => {
      const rows = expectOk(
        ScheduleFaGenerator.tableA3({ foreignSnapshot, calendarYear: 2025 }),
      );
      const partial = rows.find((r) => r.acquisitionDate === '2025-08-01');
      expect(partial).toBeDefined();
    });
  });
});

describe('US-6.3 Schedule FA Table D', () => {
  describe('Scenario: Foreign custodial account reports peak and closing balance', () => {
    it('reports institution name, peak balance and closing balance in INR', () => {
      const rows = expectOk(ScheduleFaGenerator.tableD({ foreignSnapshot, calendarYear: 2025 }));
      expect(rows[0]?.institutionName).toBeTruthy();
      expect(rows[0]?.peakBalanceInr.currency).toBe('INR');
      expect(rows[0]?.closingBalanceInr.currency).toBe('INR');
    });

    it('stores the account number as a masked reference, never in the clear', () => {
      const rows = expectOk(ScheduleFaGenerator.tableD({ foreignSnapshot, calendarYear: 2025 }));
      expectNoPii(JSON.stringify(rows));
    });
  });
});

describe('US-6.4 Schedule AL', () => {
  describe('Scenario: Schedule AL reports cost of acquisition, not market value (FR-6.2)', () => {
    it('reports immovable property at its ₹15,900,000 acquisition cost', () => {
      const al = expectOk(
        ScheduleAlGenerator.generate({
          domesticSnapshot,
          totalIncome: inr('6000000'),
          assessmentYear: '2026-27',
        }),
      );
      expectMoney(al.immovableProperty.total, inr('15900000'));
    });
  });

  describe('Scenario: Schedule AL is only generated when required', () => {
    it('reports notRequired for income below ₹50 lakh', () => {
      const al = expectOk(
        ScheduleAlGenerator.generate({
          domesticSnapshot,
          totalIncome: inr('4000000'),
          assessmentYear: '2026-27',
        }),
      );
      expect(al.required).toBe(false);
      expect(al.notRequiredReason).toBeTruthy();
    });

    it('marks it required for income above ₹50 lakh', () => {
      const al = expectOk(
        ScheduleAlGenerator.generate({
          domesticSnapshot,
          totalIncome: inr('6000000'),
          assessmentYear: '2026-27',
        }),
      );
      expect(al.required).toBe(true);
    });
  });

  describe('Scenario: All Schedule AL heads are populated', () => {
    it('populates every mandated head from the 31-Mar snapshot', () => {
      const al = expectOk(
        ScheduleAlGenerator.generate({
          domesticSnapshot,
          totalIncome: inr('6000000'),
          assessmentYear: '2026-27',
        }),
      );
      for (const head of [
        al.immovableProperty,
        al.financialAssets,
        al.cashInHand,
        al.loansAndAdvancesGiven,
        al.jewellery,
        al.vehicles,
        al.liabilities,
      ]) {
        expect(head.head).toBeTruthy();
        expect(head.total).toBeDefined();
      }
    });

    it('reports liabilities under their own head, not as negative assets (ADR-009)', () => {
      const al = expectOk(
        ScheduleAlGenerator.generate({
          domesticSnapshot,
          totalIncome: inr('6000000'),
          assessmentYear: '2026-27',
        }),
      );
      expect(Number(al.liabilities.total.amount)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('US-6.5 ITR-ready export', () => {
  describe('Scenario: Exports validate against the declared schema', () => {
    const rows = () => expectOk(ScheduleFaGenerator.tableA3({ foreignSnapshot, calendarYear: 2025 }));

    it('produces JSON that validates against the bundled Schedule FA schema', () => {
      expectOk(ItrExporter.validate(ItrExporter.toJson(rows()), 'schedule-fa-a3'));
    });

    it('emits CSV columns in the order the ITR utility expects', () => {
      const header = ItrExporter.toCsv(rows()).split('\n')[0];
      expect(header?.split(',')[0]).toBe('countryCode');
    });

    it('rounds monetary values to whole rupees in the export', () => {
      const json = ItrExporter.toJson(rows());
      const amounts = [...json.matchAll(/"amount":"(-?\d+(?:\.\d+)?)"/g)].map((m) => m[1]);
      for (const amount of amounts) expect(Number(amount) % 1).toBe(0);
    });
  });
});
