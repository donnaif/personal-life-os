/**
 * Recurrence expansion. Produces local calendar dates (YYYY-MM-DD) on which a
 * recurrence rule fires within a requested window. Pure and deterministic.
 */
import type { RecurrenceRule, Weekday, IntervalUnit } from './types.js';
import {
  addLocalDays,
  diffLocalDays,
  parseLocalDate,
  toLocalDateString,
  weekdayOfLocalDate,
} from './time.js';

export interface ExpandOptions {
  /** Inclusive local start of the search window (YYYY-MM-DD). */
  fromDate: string;
  /** Inclusive local end of the search window (YYYY-MM-DD). */
  toDate: string;
}

const UNIT_DAYS: Record<IntervalUnit, number | null> = {
  minute: null,
  hour: null,
  day: 1,
  week: 7,
  month: null,
};

/**
 * Expand a recurrence rule into concrete local dates within [fromDate, toDate].
 * Returns a sorted, de-duplicated list. `skipDates` are removed (they do not
 * break history). Sub-day `interval` rules are not expanded to dates here.
 */
export function expandRecurrence(rule: RecurrenceRule, opts: ExpandOptions): string[] {
  const start = rule.startDate ?? opts.fromDate;
  const hardEnd = rule.endDate;
  const from = diffLocalDays(start, opts.fromDate) > 0 ? opts.fromDate : start;
  const to = hardEnd && diffLocalDays(hardEnd, opts.toDate) > 0 ? hardEnd : opts.toDate;
  if (diffLocalDays(from, to) < 0) return [];

  const interval = Math.max(1, rule.interval ?? 1);
  const skip = new Set(rule.skipDates ?? []);
  const maxCount = rule.count ?? Number.POSITIVE_INFINITY;
  const out: string[] = [];
  let produced = 0;

  const push = (date: string, occurrenceNo: number): boolean => {
    produced += 1;
    if (occurrenceNo > maxCount) return false;
    if (!skip.has(date) && diffLocalDays(from, date) >= 0 && diffLocalDays(date, to) >= 0) {
      out.push(date);
    }
    return produced < maxCount;
  };

  switch (rule.frequency) {
    case 'daily': {
      let cursor = start;
      let n = 1;
      while (diffLocalDays(cursor, to) >= 0) {
        if (diffLocalDays(from, cursor) >= 0) {
          if (!push(cursor, n)) break;
        } else {
          produced += 1;
          if (produced >= maxCount) break;
        }
        cursor = addLocalDays(cursor, interval);
        n += 1;
      }
      break;
    }
    case 'weekly': {
      const days: Weekday[] = rule.byWeekdays?.length
        ? [...rule.byWeekdays].sort((a, b) => a - b)
        : [weekdayOfLocalDate(start)];
      // Align the window start to the beginning of the week containing `from`.
      let weekAnchor = from;
      let n = 1;
      while (diffLocalDays(weekAnchor, to) >= 0) {
        for (const wd of days) {
          const delta = (wd - weekdayOfLocalDate(weekAnchor) + 7) % 7;
          const date = addLocalDays(weekAnchor, delta);
          if (diffLocalDays(date, to) < 0) continue;
          if (diffLocalDays(start, date) < 0) continue;
          if (diffLocalDays(from, date) < 0) continue;
          if (!push(date, n)) {
            return dedupeSort(out);
          }
          n += 1;
        }
        weekAnchor = addLocalDays(weekAnchor, 7 * interval);
      }
      break;
    }
    case 'monthly': {
      const dayOfMonth = rule.byMonthDay?.length
        ? [...rule.byMonthDay].sort((a, b) => a - b)
        : [parseLocalDate(start).getUTCDate()];
      const startMonth = start.slice(0, 7);
      let cursorMonth = from.slice(0, 7);
      // Step months from startMonth up to the window end.
      let n = 1;
      let iterMonth = startMonth;
      while (iterMonth <= to.slice(0, 7)) {
        if (iterMonth >= cursorMonth) {
          for (const dom of dayOfMonth) {
            const date = `${iterMonth}-${String(dom).padStart(2, '0')}`;
            if (parseLocalDate(date).getUTCMonth() + 1 !== Number(iterMonth.slice(5, 7))) continue; // invalid day
            if (diffLocalDays(date, to) < 0) continue;
            if (diffLocalDays(start, date) < 0) continue;
            if (diffLocalDays(from, date) < 0) continue;
            if (!push(date, n)) return dedupeSort(out);
            n += 1;
          }
        }
        iterMonth = addMonth(iterMonth, interval);
      }
      break;
    }
    case 'interval': {
      const unit = rule.intervalUnit ?? 'day';
      const unitDays = UNIT_DAYS[unit];
      if (unitDays === null) {
        // Sub-day intervals are handled at the scheduler level, not as dates.
        return dedupeSort(out);
      }
      let cursor = start;
      let n = 1;
      while (diffLocalDays(cursor, to) >= 0) {
        if (diffLocalDays(from, cursor) >= 0) {
          if (!push(cursor, n)) break;
        } else {
          produced += 1;
          if (produced >= maxCount) break;
        }
        cursor = addLocalDays(cursor, unitDays * interval);
        n += 1;
      }
      break;
    }
    default:
      break;
  }

  return dedupeSort(out);
}

function addMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

function dedupeSort(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

/** Whether a given local date is an occurrence of the rule. */
export function occursOn(rule: RecurrenceRule, date: string): boolean {
  return expandRecurrence(rule, { fromDate: date, toDate: date }).includes(date);
}

export { toLocalDateString };
