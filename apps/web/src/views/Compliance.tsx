/**
 * Compliance — Schedule FA and Schedule AL.
 *
 * Two distinctions are stated on screen because both are easy to get backwards
 * and expensive to get wrong: Schedule FA runs on the CALENDAR year, and
 * Schedule AL reports COST of acquisition rather than market value.
 *
 * Where a schedule cannot be produced, the reason is shown rather than an empty
 * table. An empty Schedule FA and an unavailable one look identical otherwise,
 * and under the Black Money Act an omitted foreign asset is treated far more
 * harshly than an understated domestic one.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type ScheduleAl, type ScheduleFa, type ScheduleAlSection } from '../api.js';
import { Amount, Card, Chip } from '../components/primitives.js';
import { calendarYearLabel, financialYearLabel, usePeriods } from '../usePeriods.js';


function AlSection({ section }: { section: ScheduleAlSection }) {
  if (section.items.length === 0) return null;
  return (
    <>
      <tr className="pt-table__group">
        <th scope="rowgroup" colSpan={2}>
          {section.head}
        </th>
      </tr>
      {section.items.map((item, index) => (
        <tr key={`${section.head}-${String(index)}`}>
          <td>{item.description}</td>
          <td className="pt-align-end">
            <Amount value={item.costOfAcquisition} />
          </td>
        </tr>
      ))}
      <tr className="pt-table__total">
        <td>Total</td>
        <td className="pt-align-end">
          <Amount value={section.total} />
        </td>
      </tr>
    </>
  );
}

export function Compliance() {
  const periods = usePeriods();
  const [calendarYear, setCalendarYear] = useState(0);
  const [financialYear, setFinancialYear] = useState<string>('');
  const [fa, setFa] = useState<ScheduleFa | undefined>();
  const [al, setAl] = useState<ScheduleAl | undefined>();
  const [faError, setFaError] = useState<string | undefined>();
  const [alError, setAlError] = useState<string | undefined>();

  useEffect(() => {
    if (periods === undefined) return;
    // The current period is always OFFERED in the list — a user looking for
    // "this year" must find it. It is not the default, because a schedule is
    // filed for a period that has closed: Schedule FA reports the 31-December
    // position, which a running year has not reached.
    if (calendarYear === 0) setCalendarYear(periods.defaultCalendarYear);
    if (financialYear === '') setFinancialYear(periods.defaultFinancialYear);
  }, [periods, calendarYear, financialYear]);

  const selectedCalendarYear = periods?.calendarYears.find(
    (option) => option.calendarYear === calendarYear,
  );
  const selectedFinancialYear = periods?.financialYears.find(
    (option) => option.financialYear === financialYear,
  );

  const loadFa = useCallback(async (): Promise<void> => {
    setFaError(undefined);
    const result = await api.scheduleFa(calendarYear);
    if (result.ok) setFa(result.value);
    else {
      setFa(undefined);
      setFaError(result.error.message);
    }
  }, [calendarYear]);

  const loadAl = useCallback(async (): Promise<void> => {
    setAlError(undefined);
    const result = await api.scheduleAl(financialYear);
    if (result.ok) setAl(result.value);
    else {
      setAl(undefined);
      setAlError(result.error.message);
    }
  }, [financialYear]);

  return (
    <div className="pt-stack">
      <Card
        title="Schedule FA — foreign assets"
        action={
          <button type="button" className="pt-button-inline" onClick={() => void loadFa()}>
            Generate
          </button>
        }
      >
        <p className="pt-muted">
          <strong>Calendar year, not financial year.</strong> Schedule FA discloses 1 January to 31
          December, unlike every other figure in portTrack. It is generated from the frozen
          31-December snapshot, never from live values.
        </p>

        <div className="pt-controls">
          <label htmlFor="cy">Calendar year</label>
          <select
            id="cy"
            value={calendarYear}
            onChange={(event) => {
              setCalendarYear(Number(event.target.value));
            }}
          >
            {(periods?.calendarYears ?? []).map((option) => (
              <option key={option.calendarYear} value={option.calendarYear}>
                {calendarYearLabel(option)}
              </option>
            ))}
          </select>
        </div>

        {selectedCalendarYear?.isComplete === false && (
          <p className="pt-banner" role="status" data-testid="incomplete-calendar-year">
            {selectedCalendarYear.calendarYear} is still running. Schedule FA reports the position at
            31 December, so this year has no closing value until it ends — you would normally file
            for {selectedCalendarYear.calendarYear - 1}.
          </p>
        )}

        {faError !== undefined && (
          <p className="pt-error" role="alert">
            {faError}
          </p>
        )}

        {fa !== undefined && (
          <div data-testid="schedule-fa">
            <h3 className="pt-subhead">Table A3 — foreign equity and units</h3>
            {fa.tableA3Error !== null ? (
              <p className="pt-banner" role="status">
                {fa.tableA3Error.message}
              </p>
            ) : (
              <p className="pt-muted">
                {fa.tableA3?.length ?? 0} row(s) for {fa.calendarYear}.
              </p>
            )}

            <h3 className="pt-subhead">Table D — foreign custodial and bank accounts</h3>
            {fa.tableDError !== null ? (
              <p className="pt-banner" role="status">
                {fa.tableDError.message}
              </p>
            ) : fa.tableD === null || fa.tableD.length === 0 ? (
              <p className="pt-muted">
                No foreign accounts recorded for {fa.calendarYear}. Nothing to disclose.
              </p>
            ) : (
              <div className="pt-table-scroll">
                <table className="pt-table">
                  <thead>
                    <tr>
                      <th scope="col">Country</th>
                      <th scope="col">Institution</th>
                      <th scope="col">Account</th>
                      <th scope="col" className="pt-align-end">
                        Peak
                      </th>
                      <th scope="col" className="pt-align-end">
                        Closing
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fa.tableD.map((row) => (
                      <tr key={row.accountRef}>
                        <td>{row.countryCode}</td>
                        <td>{row.institutionName}</td>
                        {/* Masked reference, never the raw account number (FR-7.2). */}
                        <td className="pt-numeric pt-hash">{row.accountRef}</td>
                        <td className="pt-align-end">
                          <Amount value={row.peakBalanceInr} />
                        </td>
                        <td className="pt-align-end">
                          <Amount value={row.closingBalanceInr} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Schedule AL — assets and liabilities"
        action={
          <button type="button" className="pt-button-inline" onClick={() => void loadAl()}>
            Generate
          </button>
        }
      >
        <p className="pt-muted">
          <strong>Cost of acquisition, not market value.</strong> Every other screen shows what a
          holding is worth; this one shows what was paid for it.
        </p>

        <div className="pt-controls">
          <label htmlFor="al-fy">Financial year</label>
          <select
            id="al-fy"
            value={financialYear}
            onChange={(event) => {
              setFinancialYear(event.target.value);
            }}
          >
            {(periods?.financialYears ?? []).map((option) => (
              <option key={option.financialYear} value={option.financialYear}>
                {financialYearLabel(option)}
              </option>
            ))}
          </select>
        </div>

        {selectedFinancialYear !== undefined && (
          <p className="pt-muted" data-testid="al-assessment-year">
            Filed with the return for <strong>AY {selectedFinancialYear.assessmentYear}</strong>,
            reporting the position at 31 March{' '}
            {Number(selectedFinancialYear.financialYear.slice(0, 4)) + 1}.
          </p>
        )}

        {alError !== undefined && (
          <p className="pt-error" role="alert">
            {alError}
          </p>
        )}

        {al !== undefined && (
          <div data-testid="schedule-al">
            {!al.required ? (
              <p className="pt-muted">{al.notRequiredReason}</p>
            ) : (
              <Chip>Required for AY {al.assessmentYear}</Chip>
            )}
            <div className="pt-table-scroll">
              <table className="pt-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="pt-align-end">
                      Cost of acquisition
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    al.immovableProperty,
                    al.financialAssets,
                    al.cashInHand,
                    al.loansAndAdvancesGiven,
                    al.jewellery,
                    al.vehicles,
                    al.liabilities,
                  ].map((section) => (
                    <AlSection key={section.head} section={section} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
