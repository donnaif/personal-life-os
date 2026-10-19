import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  diffLocalDays,
  formatHHmm,
  intersectIntervals,
  makeInterval,
  normalizeIntervals,
  parseHHmm,
  subtractIntervals,
  totalMinutes,
  localWeekday,
  zonedMinutesToInstant,
  localDateString,
  weekdayOfLocalDate,
} from './time.js';

describe('HH:mm parsing', () => {
  it('parses and formats', () => {
    expect(parseHHmm('18:00')).toBe(1080);
    expect(parseHHmm('23:30')).toBe(1410);
    expect(formatHHmm(1080)).toBe('18:00');
    expect(formatHHmm(0)).toBe('00:00');
  });
  it('rejects malformed values', () => {
    expect(() => parseHHmm('25:00')).toThrow();
    expect(() => parseHHmm('9:0')).toThrow();
    expect(() => parseHHmm('ab:cd')).toThrow();
  });
});

describe('interval algebra', () => {
  it('normalizes overlapping intervals', () => {
    const out = normalizeIntervals([makeInterval(0, 10), makeInterval(5, 20), makeInterval(30, 40)]);
    expect(out).toEqual([{ startMs: 0, endMs: 20 }, { startMs: 30, endMs: 40 }]);
  });
  it('subtracts blocks correctly', () => {
    const free = subtractIntervals([makeInterval(0, 100)], [makeInterval(30, 50)]);
    expect(free).toEqual([
      { startMs: 0, endMs: 30 },
      { startMs: 50, endMs: 100 },
    ]);
  });
  it('intersects lists', () => {
    const out = intersectIntervals([makeInterval(0, 100)], [makeInterval(50, 200)]);
    expect(out).toEqual([{ startMs: 50, endMs: 100 }]);
  });
  it('computes total minutes', () => {
    expect(totalMinutes([makeInterval(0, 3_600_000), makeInterval(7_200_000, 10_800_000)])).toBe(120);
  });
  it('is half-open (touching intervals do not overlap)', () => {
    const free = subtractIntervals([makeInterval(0, 60_000)], [makeInterval(0, 60_000)]);
    expect(free).toEqual([]);
  });
});

describe('timezone helpers', () => {
  it('converts timezone minutes to an instant', () => {
    const ms = zonedMinutesToInstant('2026-01-05', 1080, 'UTC');
    expect(new Date(ms).toISOString()).toBe('2026-01-05T18:00:00.000Z');
  });
  it('computes local date and weekday', () => {
    const ms = Date.UTC(2026, 0, 5, 18, 0, 0); // Monday
    expect(localDateString(ms, 'UTC')).toBe('2026-01-05');
    expect(localWeekday(ms, 'UTC')).toBe(1);
    expect(weekdayOfLocalDate('2026-01-04')).toBe(0); // Sunday
  });
  it('handles a timezone offset (Asia/Riyadh +03)', () => {
    const ms = Date.UTC(2026, 0, 5, 15, 0, 0); // 18:00 in +03
    expect(localDateString(ms, 'Asia/Riyadh')).toBe('2026-01-05');
    expect(zonedMinutesToInstant('2026-01-05', 1080, 'Asia/Riyadh')).toBe(ms);
  });
  it('adds and diffs local days', () => {
    expect(addLocalDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(diffLocalDays('2026-01-01', '2026-01-05')).toBe(4);
  });
});
