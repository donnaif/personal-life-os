/**
 * Reporting & analytics. Pure computations over tasks, sessions and habit
 * logs. Every figure is derived from stored data — never invented.
 */
import type { Habit, HabitLog, Session, Task, TaskStatus } from './types.js';
import { MS_PER_MINUTE, localDateString } from './time.js';

export interface TaskSummary {
  total: number;
  byStatus: Record<TaskStatus, number>;
  overdue: number;
  completed: number;
  completionRate: number; // 0..1 over non-cancelled tasks
}

export function summarizeTasks(tasks: readonly Task[], nowMs: number): TaskSummary {
  const byStatus = {
    not_started: 0,
    scheduled: 0,
    ready: 0,
    in_progress: 0,
    paused: 0,
    deferred: 0,
    completed: 0,
    cancelled: 0,
  } as Record<TaskStatus, number>;

  let overdue = 0;
  for (const t of tasks) {
    byStatus[t.status] += 1;
    if (
      t.dueAt &&
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      Date.parse(t.dueAt) < nowMs
    ) {
      overdue += 1;
    }
  }
  const considered = byStatus.completed + byStatus.cancelled;
  const denominator = tasks.length - byStatus.cancelled;
  const completionRate = denominator > 0 ? byStatus.completed / denominator : 0;
  void considered;
  return {
    total: tasks.length,
    byStatus,
    overdue,
    completed: byStatus.completed,
    completionRate: Math.round(completionRate * 10000) / 10000,
  };
}

export interface SessionSummary {
  total: number;
  byStatus: Record<Session['status'], number>;
  totalPlannedMin: number;
  totalActualMin: number;
  avgActualMin: number;
  efficiency: number; // actual / planned over completed sessions
}

export function summarizeSessions(sessions: readonly Session[]): SessionSummary {
  const byStatus = {
    planned: 0,
    running: 0,
    paused: 0,
    completed: 0,
    cancelled: 0,
    missed: 0,
  } as Record<Session['status'], number>;

  let totalPlannedMin = 0;
  let totalActualMin = 0;
  for (const s of sessions) {
    byStatus[s.status] += 1;
    totalPlannedMin += s.plannedDurationMin;
    if (s.status === 'completed') totalActualMin += s.actualDurationMin ?? 0;
  }
  const completedCount = byStatus.completed;
  return {
    total: sessions.length,
    byStatus,
    totalPlannedMin: round(totalPlannedMin),
    totalActualMin: round(totalActualMin),
    avgActualMin: completedCount > 0 ? round(totalActualMin / completedCount) : 0,
    efficiency: totalPlannedMin > 0 ? totalActualMin / totalPlannedMin : 0,
  };
}

export interface DayPoint {
  date: string; // local YYYY-MM-DD
  actualMin: number;
  plannedMin: number;
  sessions: number;
  completedSessions: number;
}

/** Time series grouped by local day in the given timezone. */
export function dailyTimeSeries(sessions: readonly Session[], timezone: string): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (const s of sessions) {
    const date = localDateString(Date.parse(s.plannedStartAt), timezone);
    const point = map.get(date) ?? {
      date,
      actualMin: 0,
      plannedMin: 0,
      sessions: 0,
      completedSessions: 0,
    };
    point.sessions += 1;
    point.plannedMin += s.plannedDurationMin;
    if (s.status === 'completed') {
      point.actualMin += s.actualDurationMin ?? 0;
      point.completedSessions += 1;
    }
    map.set(date, point);
  }
  return [...map.values()]
    .map((p) => ({ ...p, actualMin: round(p.actualMin), plannedMin: round(p.plannedMin) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface CategoryTime {
  categoryId: string | null;
  actualMin: number;
  plannedMin: number;
  sessions: number;
}

/** Aggregate worked/planned minutes per task category. */
export function timeByCategory(
  sessions: readonly Session[],
  tasks: readonly Task[],
): CategoryTime[] {
  const taskCat = new Map(tasks.map((t) => [t.id, t.categoryId ?? null] as const));
  const map = new Map<string, CategoryTime>();
  for (const s of sessions) {
    const key = taskCat.get(s.taskId) ?? null;
    const k = key ?? '__none__';
    const entry = map.get(k) ?? { categoryId: key, actualMin: 0, plannedMin: 0, sessions: 0 };
    entry.sessions += 1;
    entry.plannedMin += s.plannedDurationMin;
    if (s.status === 'completed') entry.actualMin += s.actualDurationMin ?? 0;
    map.set(k, entry);
  }
  return [...map.values()]
    .map((e) => ({ ...e, actualMin: round(e.actualMin), plannedMin: round(e.plannedMin) }))
    .sort((a, b) => b.actualMin - a.actualMin);
}

/**
 * Current consecutive-day streak for a habit, walking backwards from `today`.
 * Rest days and explicit skip dates do not break the streak.
 */
export function habitStreak(
  habit: Habit,
  logs: readonly HabitLog[],
  today: string,
): { current: number; longest: number } {
  const byDate = new Map(logs.map((l) => [l.date, l] as const));
  const skip = new Set([...(habit.skipDates ?? []), ...(habit.restDates ?? [])]);
  const done = (date: string): boolean => {
    const l = byDate.get(date);
    return !!l && l.completed && l.count >= habit.targetCount;
  };

  // current streak
  let current = 0;
  let cursor = today;
  for (let guard = 0; guard < 3650; guard += 1) {
    if (done(cursor)) current += 1;
    else if (skip.has(cursor)) {
      // allowed skip, do not break
    } else {
      break;
    }
    cursor = shiftDate(cursor, -1);
  }

  // longest streak over the logged range
  const dates = [...byDate.keys()].sort();
  let longest = 0;
  let run = 0;
  if (dates.length > 0) {
    let d = dates[0]!;
    const last = dates[dates.length - 1]!;
    for (let guard = 0; guard < 3650 && d <= last; guard += 1) {
      if (done(d)) {
        run += 1;
        longest = Math.max(longest, run);
      } else if (!skip.has(d)) {
        run = 0;
      }
      d = shiftDate(d, 1);
    }
  }
  return { current, longest: Math.max(longest, current) };
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export { MS_PER_MINUTE };
