/**
 * Financial, assessment and calendar years, fetched from the API.
 *
 * Shared by Tax and Compliance so the two can never offer different year lists.
 * The values are server-derived on purpose (see `api.periods`): the browser's
 * idea of today can differ from the server's by a day across a timezone, and on
 * 31 March / 1 April that is a different financial year.
 *
 * `undefined` while loading, so a caller can tell "not known yet" from "known to
 * be empty" and avoid rendering a picker with nothing in it.
 */
import { useEffect, useState } from 'react';
import { api, type Periods } from './api.js';

export function usePeriods(): Periods | undefined {
  const [periods, setPeriods] = useState<Periods | undefined>();

  useEffect(() => {
    // Guarded against a response arriving after unmount: in a hash-routed shell
    // a user can leave a section before its fetch resolves. Held on an object
    // rather than a plain `let` because the compiler narrows a captured boolean
    // to its initial value and then flags the check as dead code.
    const live = { current: true };

    void (async () => {
      const result = await api.periods();
      if (live.current && result.ok) setPeriods(result.value);
    })();

    return () => {
      live.current = false;
    };
  }, []);

  return periods;
}

/** `2025-26 (current)` — the label a year picker shows. */
export function financialYearLabel(option: {
  financialYear: string;
  assessmentYear: string;
  isCurrent: boolean;
  rulesAvailable: boolean;
}): string {
  const parts = [`FY ${option.financialYear}`, `· AY ${option.assessmentYear}`];
  if (option.isCurrent) parts.push('· current');
  // Shown in the option itself: selecting a year with no rule set is allowed,
  // but the user should know before they select it, not after the error.
  if (!option.rulesAvailable) parts.push('· no rates yet');
  return parts.join(' ');
}

export function calendarYearLabel(option: {
  calendarYear: number;
  isCurrent: boolean;
  isComplete: boolean;
}): string {
  if (option.isCurrent) return `${String(option.calendarYear)} · current, still running`;
  return String(option.calendarYear);
}
