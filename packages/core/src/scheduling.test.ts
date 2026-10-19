import { describe, expect, it } from 'vitest';
import { buildAlertPlan, freeIntervalsForDay, planSchedule, planTask, resolveSessionRule } from './scheduling.js';
import type { SchedulerOptions } from './scheduling.js';
import type { DayAvailability, LocalTimeRange, PlannedSession, Task } from './types.js';
import { makeInterval } from './time.js';

const MONDAY_0000 = Date.UTC(2026, 0, 5, 0, 0, 0);

function fullWeek(): DayAvailability[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday: weekday as DayAvailability['weekday'],
    windows: [{ startMin: 0, endMin: 1440 }],
  }));
}

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 't1',
    userId: 'u1',
    title: 'Task',
    status: 'not_started',
    priority: 3,
    createdAt: new Date(MONDAY_0000).toISOString(),
    updatedAt: new Date(MONDAY_0000).toISOString(),
    version: 1,
    ...overrides,
  };
}

function opts(overrides: Partial<SchedulerOptions> = {}): SchedulerOptions {
  return {
    timezone: 'UTC',
    availability: fullWeek(),
    quietHours: [],
    busy: [],
    allowOverlap: false,
    defaultSessionDurationMin: 30,
    defaultBreakMin: 0,
    minLeadTimeMin: 0,
    nowMs: MONDAY_0000,
    horizonDays: 7,
    ...overrides,
  };
}

function startHHmm(sessions: PlannedSession[], tz = 'UTC'): string[] {
  return sessions.map((s) =>
    new Date(s.startMs).toLocaleTimeString('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' }),
  );
}

describe('scheduling — mandatory cleaning example', () => {
  // Clean the apartment: 15 min per session, reminder every 2 hours between 18:00 and 23:00.
  const cleaning = task({
    id: 'clean',
    title: 'Clean apartment',
    windowStart: '18:00',
    windowEnd: '23:00',
    sessionDurationMin: 15,
    sessionIntervalMin: 120,
    intervalAnchor: 'start',
    sessionCount: 3,
  });

  it('produces sessions every 2h from 18:00 to 23:00', () => {
    const res = planTask(cleaning, opts());
    expect(res.conflicts).toEqual([]);
    expect(res.sessions).toHaveLength(3);
    expect(startHHmm(res.sessions)).toEqual(['18:00', '20:00', '22:00']);
    for (const s of res.sessions) expect(s.endMs - s.startMs).toBe(15 * 60_000);
  });

  it('derives the count from the estimate when sessionCount is omitted', () => {
    const t = task({
      windowStart: '18:00',
      windowEnd: '23:00',
      sessionDurationMin: 15,
      sessionIntervalMin: 120,
      intervalAnchor: 'start',
      estimatedDurationMin: 45,
    });
    const res = planTask(t, opts());
    expect(res.sessions).toHaveLength(3);
    expect(startHHmm(res.sessions)).toEqual(['18:00', '20:00', '22:00']);
  });

  it('does not place sessions in quiet hours', () => {
    const quiet: LocalTimeRange[] = [{ startMin: 20 * 60, endMin: 24 * 60 }];
    const res = planTask(cleaning, opts({ quietHours: quiet }));
    // Only 18:00 remains within 18:00-23:00; remaining sessions roll to the next day.
    expect(startHHmm(res.sessions.slice(0, 1))).toEqual(['18:00']);
    expect(res.sessions).toHaveLength(3);
  });
});

describe('scheduling — conflicts are surfaced', () => {
  it('reports no_capacity when the window is too small for one session', () => {
    const t = task({
      windowStart: '18:00',
      windowEnd: '18:10',
      sessionDurationMin: 15,
      sessionCount: 1,
    });
    const res = planTask(t, opts());
    expect(res.sessions).toHaveLength(0);
    expect(res.conflicts[0]?.reason).toBe('no_capacity');
    expect(res.conflicts[0]?.unplacedSessions).toBe(1);
  });
});

describe('scheduling — busy time and overlap', () => {
  it('avoids an existing appointment', () => {
    const t = task({ id: 'a', estimatedDurationMin: 60, sessionDurationMin: 60 });
    const busy = [makeInterval(Date.UTC(2026, 0, 5, 8, 0), Date.UTC(2026, 0, 5, 12, 0))];
    const availability: DayAvailability[] = [
      { weekday: 1, windows: [{ startMin: 9 * 60, endMin: 15 * 60 }] },
    ];
    const res = planTask(t, opts({ busy, availability }));
    expect(res.sessions).toHaveLength(1);
    expect(new Date(res.sessions[0]!.startMs).toISOString()).toBe('2026-01-05T12:00:00.000Z');
  });

  it('allows overlap only when enabled', () => {
    const availability: DayAvailability[] = [{ weekday: 1, windows: [{ startMin: 9 * 60, endMin: 12 * 60 }] }];
    const busy = [makeInterval(Date.UTC(2026, 0, 5, 9, 0), Date.UTC(2026, 0, 5, 12, 0))];
    const t = task({ estimatedDurationMin: 60, sessionDurationMin: 60 });
    // horizon 0 = today only, so the weekly window does not roll to next Monday.
    expect(planTask(t, opts({ busy, availability, horizonDays: 0 })).sessions).toHaveLength(0);
    expect(planTask(t, opts({ busy, availability, horizonDays: 0, allowOverlap: true })).sessions).toHaveLength(1);
  });
});

describe('scheduling — multi-task plan', () => {
  it('never overlaps sessions and follows priority order', () => {
    const availability: DayAvailability[] = [{ weekday: 1, windows: [{ startMin: 9 * 60, endMin: 13 * 60 }] }];
    const a = task({ id: 'a', priority: 1, estimatedDurationMin: 60, sessionDurationMin: 60 });
    const b = task({ id: 'b', priority: 2, estimatedDurationMin: 60, sessionDurationMin: 60 });
    const { results } = planSchedule([b, a], opts({ availability }));
    const aS = results.find((r) => r.taskId === 'a')!.sessions[0]!;
    const bS = results.find((r) => r.taskId === 'b')!.sessions[0]!;
    expect(aS.startMs).toBe(Date.UTC(2026, 0, 5, 9, 0));
    expect(bS.startMs).toBe(Date.UTC(2026, 0, 5, 10, 0));
    expect(aS.endMs).toBeLessThanOrEqual(bS.startMs);
  });

  it('schedules a dependent task after its dependency', () => {
    const availability: DayAvailability[] = [{ weekday: 1, windows: [{ startMin: 9 * 60, endMin: 13 * 60 }] }];
    const first = task({ id: 'first', priority: 3, estimatedDurationMin: 60, sessionDurationMin: 60 });
    const second = task({ id: 'second', priority: 1, estimatedDurationMin: 60, sessionDurationMin: 60, dependsOn: ['first'] });
    const { results } = planSchedule([second, first], opts({ availability }));
    const f = results.find((r) => r.taskId === 'first')!.sessions[0]!;
    const s = results.find((r) => r.taskId === 'second')!.sessions[0]!;
    expect(s.startMs).toBeGreaterThanOrEqual(f.endMs); // dependency wins over priority
  });

  it('detects circular dependencies', () => {
    const a = task({ id: 'a', dependsOn: ['b'] });
    const b = task({ id: 'b', dependsOn: ['a'] });
    const { conflicts } = planSchedule([a, b], opts());
    expect(conflicts.filter((c) => c.reason === 'dependency_blocked').length).toBeGreaterThan(0);
  });
});

describe('scheduling — helpers', () => {
  it('resolves session rules with defaults', () => {
    const rule = resolveSessionRule(task({ estimatedDurationMin: 90 }), opts({ defaultSessionDurationMin: 30 }));
    expect(rule.sessionCount).toBe(3);
    expect(rule.sessionDurationMin).toBe(30);
    expect(rule.anchor).toBe('end');
  });

  it('freeIntervalsForDay respects the task window', () => {
    const free = freeIntervalsForDay(
      '2026-01-05',
      task({ windowStart: '18:00', windowEnd: '20:00' }),
      opts(),
    );
    expect(free).toHaveLength(1);
    expect(new Date(free[0]!.startMs).toISOString()).toBe('2026-01-05T18:00:00.000Z');
    expect(new Date(free[0]!.endMs).toISOString()).toBe('2026-01-05T20:00:00.000Z');
  });

  it('builds the alert plan from session times', () => {
    const t = task({
      windowStart: '18:00',
      windowEnd: '23:00',
      sessionDurationMin: 15,
      sessionIntervalMin: 120,
      intervalAnchor: 'start',
      sessionCount: 1,
      alert: { enabled: true, atStart: true, atEnd: true, offsetBeforeMin: 5, soundEnabled: true },
    });
    const res = planTask(t, opts());
    const plan = buildAlertPlan(t, res.sessions);
    expect(plan).toHaveLength(1);
    // 17:55 pre-alert, 18:00 start, 18:15 end
    expect(plan[0]!.atMs.map((m) => new Date(m).toISOString())).toEqual([
      '2026-01-05T17:55:00.000Z',
      '2026-01-05T18:00:00.000Z',
      '2026-01-05T18:15:00.000Z',
    ]);
  });
});
