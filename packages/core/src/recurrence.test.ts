import { describe, expect, it } from 'vitest';
import { expandRecurrence, occursOn } from './recurrence.js';
import type { RecurrenceRule } from './types.js';

describe('recurrence expansion', () => {
  it('daily', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: '2026-01-01' };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-01', toDate: '2026-01-05' });
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
  });

  it('daily with interval', () => {
    const rule: RecurrenceRule = { frequency: 'daily', interval: 2, startDate: '2026-01-01' };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-01', toDate: '2026-01-07' });
    expect(dates).toEqual(['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-07']);
  });

  it('weekly on specific weekdays', () => {
    // 2026-01-05 is Monday (1). 2026-01-04 is Sunday (0).
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      byWeekdays: [0, 1],
      startDate: '2026-01-04',
    };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-04', toDate: '2026-01-18' });
    expect(dates).toEqual([
      '2026-01-04',
      '2026-01-05',
      '2026-01-11',
      '2026-01-12',
      '2026-01-18',
    ]);
  });

  it('monthly on day of month', () => {
    const rule: RecurrenceRule = { frequency: 'monthly', byMonthDay: [1, 15], startDate: '2026-01-01' };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-01', toDate: '2026-03-01' });
    expect(dates).toEqual(['2026-01-01', '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01']);
  });

  it('respects count', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: '2026-01-01', count: 3 };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-01', toDate: '2026-01-10' });
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('respects endDate', () => {
    const rule: RecurrenceRule = { frequency: 'daily', startDate: '2026-01-01', endDate: '2026-01-03' };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-01', toDate: '2026-01-10' });
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('skips skipDates without breaking the pattern', () => {
    const rule: RecurrenceRule = {
      frequency: 'daily',
      startDate: '2026-01-01',
      skipDates: ['2026-01-03'],
    };
    const dates = expandRecurrence(rule, { fromDate: '2026-01-01', toDate: '2026-01-05' });
    expect(dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05']);
  });

  it('occursOn helper', () => {
    expect(occursOn({ frequency: 'daily', startDate: '2026-01-01' }, '2026-01-08')).toBe(true);
    expect(occursOn({ frequency: 'weekly', byWeekdays: [1] }, '2026-01-07')).toBe(false);
  });
});
