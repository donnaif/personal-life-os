/**
 * Time utilities: wall-clock parsing, timezone-aware day math, interval algebra.
 * All interval algebra operates on absolute epoch milliseconds with half-open
 * ranges [startMs, endMs).
 */
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addDays, addMinutes } from 'date-fns';
import type { LocalTimeRange, TimeInterval, Weekday } from './types.js';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Wall-clock helpers
// ---------------------------------------------------------------------------

/** Parse "HH:mm" into minutes from midnight. Throws on malformed input. */
export function parseHHmm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid HH:mm value: "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw new Error(`Out-of-range HH:mm value: "${value}"`);
  }
  return h * 60 + min;
}

/** Format minutes-from-midnight as "HH:mm" (wraps within 0..1439). */
export function formatHHmm(minutes: number): string {
  const norm = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Normalize a LocalTimeRange from HH:mm strings. */
export function toTimeRange(start: string, end: string): LocalTimeRange {
  return { startMin: parseHHmm(start), endMin: parseHHmm(end) };
}

// ---------------------------------------------------------------------------
// Timezone-aware conversions
// ---------------------------------------------------------------------------

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateString(instantMs: number, timezone: string): string {
  return formatInTimeZone(new Date(instantMs), timezone, 'yyyy-MM-dd');
}

/** Weekday (0=Sun..6=Sat) of an instant in a timezone. */
export function localWeekday(instantMs: number, timezone: string): Weekday {
  const iso = Number(formatInTimeZone(new Date(instantMs), timezone, 'i')); // ISO: 1=Mon..7=Sun
  return (iso === 7 ? 0 : iso) as Weekday;
}

/**
 * Convert a local date + minutes-from-midnight in a timezone to an absolute
 * epoch-ms instant. Handles DST gaps by delegating to date-fns-tz.
 */
export function zonedMinutesToInstant(
  localDate: string,
  minutesFromMidnight: number,
  timezone: string,
): number {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  const hh = String(((h % 24) + 24) % 24).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const dayOffset = Math.floor(minutesFromMidnight / 1440);
  const baseDate = dayOffset === 0 ? localDate : toLocalDateString(addDays(parseLocalDate(localDate), dayOffset));
  return fromZonedTime(`${baseDate}T${hh}:${mm}:00`, timezone).getTime();
}

/** Parse a YYYY-MM-DD string into a Date at UTC midnight (date-only carrier). */
export function parseLocalDate(localDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) throw new Error(`Invalid local date: "${localDate}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Format a UTC-midnight carrier Date back to YYYY-MM-DD. */
export function toLocalDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Add whole days to a YYYY-MM-DD string. */
export function addLocalDays(localDate: string, days: number): string {
  return toLocalDateString(addDays(parseLocalDate(localDate), days));
}

/** Difference in whole days between two YYYY-MM-DD strings (b - a). */
export function diffLocalDays(a: string, b: string): number {
  return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / MS_PER_DAY);
}

/** Local weekday of a YYYY-MM-DD date (0=Sun..6=Sat). */
export function weekdayOfLocalDate(localDate: string): Weekday {
  return parseLocalDate(localDate).getUTCDay() as Weekday;
}

// ---------------------------------------------------------------------------
// Interval algebra (absolute ms, half-open [start, end))
// ---------------------------------------------------------------------------

export function makeInterval(startMs: number, endMs: number): TimeInterval {
  return { startMs, endMs };
}

export function isValidInterval(iv: TimeInterval): boolean {
  return Number.isFinite(iv.startMs) && Number.isFinite(iv.endMs) && iv.endMs > iv.startMs;
}

export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Merge overlapping/touching intervals into a sorted, disjoint list. */
export function normalizeIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const valid = intervals.filter(isValidInterval).sort((x, y) => x.startMs - y.startMs);
  const out: TimeInterval[] = [];
  for (const iv of valid) {
    const last = out[out.length - 1];
    if (last && iv.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, iv.endMs);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** Subtract `blocks` from `base`, returning the remaining free intervals. */
export function subtractIntervals(
  base: readonly TimeInterval[],
  blocks: readonly TimeInterval[],
): TimeInterval[] {
  const blockers = normalizeIntervals(blocks);
  const result: TimeInterval[] = [];
  for (const src of normalizeIntervals(base)) {
    let cursor = src.startMs;
    for (const b of blockers) {
      if (b.endMs <= cursor || b.startMs >= src.endMs) continue;
      if (b.startMs > cursor) {
        result.push(makeInterval(cursor, Math.min(b.startMs, src.endMs)));
      }
      cursor = Math.max(cursor, b.endMs);
      if (cursor >= src.endMs) break;
    }
    if (cursor < src.endMs) result.push(makeInterval(cursor, src.endMs));
  }
  return result.filter(isValidInterval);
}

/** Intersection of two interval lists. */
export function intersectIntervals(
  a: readonly TimeInterval[],
  b: readonly TimeInterval[],
): TimeInterval[] {
  const left = normalizeIntervals(a);
  const right = normalizeIntervals(b);
  const out: TimeInterval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i]!;
    const y = right[j]!;
    const start = Math.max(x.startMs, y.startMs);
    const end = Math.min(x.endMs, y.endMs);
    if (end > start) out.push(makeInterval(start, end));
    if (x.endMs < y.endMs) i += 1;
    else j += 1;
  }
  return out;
}

/** Total length of a set of intervals in minutes. */
export function totalMinutes(intervals: readonly TimeInterval[]): number {
  return normalizeIntervals(intervals).reduce((acc, iv) => acc + (iv.endMs - iv.startMs) / MS_PER_MINUTE, 0);
}

export { addMinutes };
