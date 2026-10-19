import { describe, expect, it } from 'vitest';
import {
  dailyTimeSeries,
  habitStreak,
  summarizeSessions,
  summarizeTasks,
  timeByCategory,
} from './reports.js';
import type { Habit, HabitLog, Session, Task } from './types.js';

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);
const MIN = 60_000;

function task(over: Partial<Task>): Task {
  return {
    id: 't',
    userId: 'u1',
    title: 'T',
    status: 'not_started',
    priority: 3,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    version: 1,
    ...over,
  };
}

function session(over: Partial<Session>): Session {
  return {
    id: 's',
    userId: 'u1',
    taskId: 't',
    index: 0,
    status: 'completed',
    plannedStartAt: new Date(NOW).toISOString(),
    plannedEndAt: new Date(NOW + 30 * MIN).toISOString(),
    plannedDurationMin: 30,
    actualDurationMin: 25,
    pausedAccumulatedMs: 0,
    updatedAt: new Date(NOW).toISOString(),
    version: 1,
    ...over,
  };
}

describe('summarizeTasks', () => {
  it('computes status counts, overdue and completion rate', () => {
    const tasks = [
      task({ id: '1', status: 'completed' }),
      task({ id: '2', status: 'in_progress', dueAt: new Date(NOW - MIN).toISOString() }),
      task({ id: '3', status: 'cancelled' }),
    ];
    const s = summarizeTasks(tasks, NOW);
    expect(s.byStatus.completed).toBe(1);
    expect(s.byStatus.cancelled).toBe(1);
    expect(s.overdue).toBe(1); // task 2 past due
    expect(s.completionRate).toBe(0.5); // 1 completed / (3 - 1 cancelled)
  });
});

describe('summarizeSessions', () => {
  it('aggregates planned vs actual and efficiency', () => {
    const sessions = [
      session({ id: '1', actualDurationMin: 25, plannedDurationMin: 30 }),
      session({ id: '2', status: 'cancelled', actualDurationMin: undefined, plannedDurationMin: 30 }),
    ];
    const s = summarizeSessions(sessions);
    expect(s.total).toBe(2);
    expect(s.totalPlannedMin).toBe(60);
    expect(s.totalActualMin).toBe(25);
    expect(s.efficiency).toBeCloseTo(25 / 60, 3);
  });
});

describe('dailyTimeSeries', () => {
  it('groups sessions by local day in the timezone', () => {
    const sessions = [
      session({ id: '1', plannedStartAt: new Date(Date.UTC(2026, 0, 5, 10, 0)).toISOString() }),
      session({ id: '2', plannedStartAt: new Date(Date.UTC(2026, 0, 5, 15, 0)).toISOString() }),
      session({ id: '3', plannedStartAt: new Date(Date.UTC(2026, 0, 6, 9, 0)).toISOString() }),
    ];
    const series = dailyTimeSeries(sessions, 'UTC');
    expect(series.map((p) => p.date)).toEqual(['2026-01-05', '2026-01-06']);
    expect(series[0]!.sessions).toBe(2);
    expect(series[0]!.actualMin).toBe(50);
  });

  it('respects the timezone when bucketing', () => {
    // 22:00 UTC on the 5th is 01:00 on the 6th in Asia/Riyadh (+03)
    const sessions = [session({ id: '1', plannedStartAt: new Date(Date.UTC(2026, 0, 5, 22, 0)).toISOString() })];
    expect(dailyTimeSeries(sessions, 'Asia/Riyadh')[0]!.date).toBe('2026-01-06');
  });
});

describe('timeByCategory', () => {
  it('aggregates actual minutes per category', () => {
    const tasks = [task({ id: 'a', categoryId: 'work' }), task({ id: 'b', categoryId: 'home' })];
    const sessions = [
      session({ id: '1', taskId: 'a', actualDurationMin: 30 }),
      session({ id: '2', taskId: 'a', actualDurationMin: 10 }),
      session({ id: '3', taskId: 'b', actualDurationMin: 20 }),
    ];
    const rows = timeByCategory(sessions, tasks);
    expect(rows[0]).toMatchObject({ categoryId: 'work', actualMin: 40, sessions: 2 });
    expect(rows[1]).toMatchObject({ categoryId: 'home', actualMin: 20 });
  });
});

describe('habitStreak', () => {
  const habit: Habit = {
    id: 'h',
    userId: 'u1',
    title: 'Read',
    targetCount: 1,
    targetPeriod: 'day',
    skipDates: ['2026-01-07'],
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    version: 1,
  };
  function log(date: string, completed = true, count = 1): HabitLog {
    return { id: date, userId: 'u1', habitId: 'h', date, completed, count, updatedAt: NOW.toString(), version: 1 };
  }

  it('counts a current streak across an allowed skip day', () => {
    const logs = [log('2026-01-05'), log('2026-01-06'), log('2026-01-08'), log('2026-01-09'), log('2026-01-10')];
    // 01-07 is an allowed skip → streak continues
    expect(habitStreak(habit, logs, '2026-01-10').current).toBe(5);
  });

  it('breaks a streak on a missed non-skip day', () => {
    const logs = [log('2026-01-05'), log('2026-01-06'), log('2026-01-09'), log('2026-01-10')];
    expect(habitStreak(habit, logs, '2026-01-10').current).toBe(2);
  });

  it('computes the longest streak', () => {
    const logs = [log('2026-01-01'), log('2026-01-02'), log('2026-01-03'), log('2026-01-06'), log('2026-01-08'), log('2026-01-09'), log('2026-01-10')];
    expect(habitStreak(habit, logs, '2026-01-10').longest).toBeGreaterThanOrEqual(4);
  });
});
