/**
 * Scheduling engine.
 *
 * Turns tasks into concrete, non-overlapping sessions placed inside the user's
 * real availability, respecting quiet hours, existing appointments, fixed
 * windows, dependencies and per-task session rules. Conflicts are surfaced,
 * never silently dropped.
 *
 * All math is on absolute epoch-ms with half-open [start, end) intervals.
 */
import type {
  DayAvailability,
  LocalTimeRange,
  PlannedSession,
  ScheduleConflict,
  Task,
  TaskAlertPlan,
  TaskPlanResult,
  TimeInterval,
  Weekday,
} from './types.js';
import { TERMINAL_TASK_STATUSES } from './types.js';
import {
  MS_PER_MINUTE,
  addLocalDays,
  intersectIntervals,
  makeInterval,
  subtractIntervals,
  weekdayOfLocalDate,
  zonedMinutesToInstant,
  localDateString,
} from './time.js';

export interface SchedulerOptions {
  timezone: string;
  availability: DayAvailability[];
  quietHours: LocalTimeRange[];
  /** Fixed appointments / already-placed sessions to avoid. */
  busy: TimeInterval[];
  allowOverlap: boolean;
  defaultSessionDurationMin: number;
  defaultBreakMin: number;
  minLeadTimeMin: number;
  nowMs: number;
  /** How many days ahead the scheduler may reach. */
  horizonDays: number;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

function windowsToIntervals(localDate: string, windows: LocalTimeRange[], tz: string): TimeInterval[] {
  const out: TimeInterval[] = [];
  for (const w of windows) {
    const startMin = w.startMin;
    let endMin = w.endMin;
    if (endMin <= startMin) endMin += 1440; // spans past midnight
    const startMs = zonedMinutesToInstant(localDate, startMin, tz);
    const endMs = zonedMinutesToInstant(localDate, endMin, tz);
    if (endMs > startMs) out.push(makeInterval(startMs, endMs));
  }
  return out;
}

function availabilityForWeekday(availability: DayAvailability[], weekday: Weekday): LocalTimeRange[] {
  const day = availability.find((a) => a.weekday === weekday);
  return day ? day.windows : [];
}

/**
 * Free intervals for one local day: availability ∩ task window, minus quiet
 * hours, minus busy (unless overlaps are explicitly allowed).
 */
export function freeIntervalsForDay(
  localDate: string,
  task: Task,
  opts: SchedulerOptions,
): TimeInterval[] {
  const weekday = weekdayOfLocalDate(localDate);
  const availWindows = availabilityForWeekday(opts.availability, weekday);
  if (availWindows.length === 0) return [];

  let free = windowsToIntervals(localDate, availWindows, opts.timezone);

  if (task.windowStart && task.windowEnd) {
    const startMin = parseMinutes(task.windowStart);
    let endMin = parseMinutes(task.windowEnd);
    if (endMin <= startMin) endMin += 1440;
    const taskWindow = windowsToIntervals(localDate, [{ startMin, endMin }], opts.timezone);
    free = intersectIntervals(free, taskWindow);
  }

  const quiet = windowsToIntervals(localDate, opts.quietHours, opts.timezone);
  const quietPrevNext = [
    ...windowsToIntervals(addLocalDays(localDate, -1), opts.quietHours, opts.timezone),
    ...quiet,
    ...windowsToIntervals(addLocalDays(localDate, 1), opts.quietHours, opts.timezone),
  ];
  free = subtractIntervals(free, quietPrevNext);

  if (!opts.allowOverlap) free = subtractIntervals(free, opts.busy);

  return free;
}

function parseMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid HH:mm: "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// ---------------------------------------------------------------------------
// Session rule resolution
// ---------------------------------------------------------------------------

export interface ResolvedSessionRule {
  sessionDurationMin: number;
  sessionCount: number;
  spacingMs: number;
  anchor: 'start' | 'end';
}

export function resolveSessionRule(task: Task, opts: SchedulerOptions): ResolvedSessionRule {
  const sessionDurationMin =
    task.sessionDurationMin && task.sessionDurationMin > 0
      ? task.sessionDurationMin
      : opts.defaultSessionDurationMin;

  let sessionCount = task.sessionCount && task.sessionCount > 0 ? task.sessionCount : 0;
  if (sessionCount === 0) {
    if (task.estimatedDurationMin && task.estimatedDurationMin > 0) {
      sessionCount = Math.max(1, Math.ceil(task.estimatedDurationMin / sessionDurationMin));
    } else {
      sessionCount = 1;
    }
  }

  const anchor = task.intervalAnchor ?? 'end';
  const durMs = sessionDurationMin * MS_PER_MINUTE;
  const breakMs = Math.max(0, opts.defaultBreakMin) * MS_PER_MINUTE;
  const spacingMs =
    task.sessionIntervalMin != null
      ? Math.max(0, task.sessionIntervalMin) * MS_PER_MINUTE
      : anchor === 'start'
        ? durMs + breakMs
        : breakMs;

  return { sessionDurationMin, sessionCount, spacingMs, anchor };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Find the earliest instant >= `wantMs` at which a session of `durMs` fits
 * inside a free interval. Returns null if none fits in the given set.
 */
export function placeSession(
  wantMs: number,
  durMs: number,
  free: readonly TimeInterval[],
): number | null {
  for (const iv of free) {
    if (iv.startMs > wantMs) {
      if (iv.endMs - iv.startMs >= durMs) return iv.startMs;
      continue;
    }
    if (wantMs + durMs <= iv.endMs) return wantMs;
  }
  return null;
}

export interface PlanTaskOptions extends SchedulerOptions {
  /** Earliest instant at which this task may begin (e.g. after dependencies). */
  earliestStartMs?: number;
}

/** Plan all sessions of a single task. */
export function planTask(task: Task, opts: PlanTaskOptions): TaskPlanResult {
  const conflicts: ScheduleConflict[] = [];
  if (TERMINAL_TASK_STATUSES.includes(task.status)) {
    return { taskId: task.id, sessions: [], conflicts };
  }

  const rule = resolveSessionRule(task, opts);
  const durMs = rule.sessionDurationMin * MS_PER_MINUTE;
  const sessions: PlannedSession[] = [];

  let cursor = Math.max(opts.nowMs + opts.minLeadTimeMin * MS_PER_MINUTE, opts.earliestStartMs ?? 0);
  let index = 0;
  let searchedDays = 0;

  const startDate = localDateString(cursor, opts.timezone);
  let day = startDate;

  while (index < rule.sessionCount && searchedDays <= opts.horizonDays) {
    const free = freeIntervalsForDay(day, task, opts);
    while (index < rule.sessionCount) {
      const placedStart = placeSession(cursor, durMs, free);
      if (placedStart === null) break;
      const endMs = placedStart + durMs;
      sessions.push({
        taskId: task.id,
        index,
        startMs: placedStart,
        endMs,
        durationMin: rule.sessionDurationMin,
      });
      index += 1;
      cursor =
        rule.anchor === 'start' ? placedStart + rule.spacingMs : endMs + rule.spacingMs;
    }
    day = addLocalDays(day, 1);
    searchedDays += 1;
    // Ensure the cursor never moves backwards when crossing into a new day.
    const nextDayStart = zonedMinutesToInstant(day, 0, opts.timezone);
    if (cursor < nextDayStart) cursor = nextDayStart;
  }

  if (index < rule.sessionCount) {
    conflicts.push({
      taskId: task.id,
      unplacedSessions: rule.sessionCount - index,
      reason: index === 0 ? 'no_capacity' : 'horizon_exceeded',
      detail: `placed ${index}/${rule.sessionCount} sessions within ${opts.horizonDays}d horizon`,
    });
  }

  return { taskId: task.id, sessions, conflicts };
}

// ---------------------------------------------------------------------------
// Whole-schedule planning (multi-task, dependency aware)
// ---------------------------------------------------------------------------

export interface ScheduleResult {
  results: TaskPlanResult[];
  timeline: TimeInterval[];
  conflicts: ScheduleConflict[];
}

/**
 * Plan many tasks into one non-overlapping timeline.
 * Order: dependencies first, then by priority (1 highest) and due date.
 */
export function planSchedule(tasks: readonly Task[], opts: SchedulerOptions): ScheduleResult {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const { order, cyclic } = topoOrder(tasks, byId);

  const busy: TimeInterval[] = [...opts.busy];
  const lastEnd = new Map<string, number>();
  const results: TaskPlanResult[] = [];
  const conflicts: ScheduleConflict[] = [];

  for (const taskId of cyclic) {
    conflicts.push({
      taskId,
      unplacedSessions: 0,
      reason: 'dependency_blocked',
      detail: 'circular dependency detected',
    });
  }

  for (const taskId of order) {
    const task = byId.get(taskId);
    if (!task) continue;
    let earliest = opts.nowMs + opts.minLeadTimeMin * MS_PER_MINUTE;
    for (const dep of task.dependsOn ?? []) {
      earliest = Math.max(earliest, lastEnd.get(dep) ?? 0);
    }
    const result = planTask(task, { ...opts, busy, earliestStartMs: earliest });
    results.push(result);
    conflicts.push(...result.conflicts);
    for (const s of result.sessions) {
      const iv = makeInterval(s.startMs, s.endMs);
      if (!opts.allowOverlap) busy.push(iv);
      lastEnd.set(task.id, Math.max(lastEnd.get(task.id) ?? 0, s.endMs));
    }
    if (result.sessions.length === 0) lastEnd.set(task.id, earliest);
  }

  return { results, timeline: busy, conflicts };
}

function compareTasks(a: Task | undefined, b: Task | undefined): number {
  if (!a || !b) return 0;
  if (a.priority !== b.priority) return a.priority - b.priority;
  const da = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  const db = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return a.createdAt.localeCompare(b.createdAt);
}

function topoOrder(
  tasks: readonly Task[],
  byId: Map<string, Task>,
): { order: string[]; cyclic: string[] } {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, 0);
    adj.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!byId.has(dep)) continue; // unknown dep: ignore for ordering
      adj.get(dep)!.push(t.id);
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
    }
  }
  // Kahn's algorithm, but always release the highest-priority available task
  // first. Dependencies always win over priority.
  const available = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: string[] = [];
  while (available.length > 0) {
    available.sort((a, b) => compareTasks(byId.get(a), byId.get(b)));
    const id = available.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) available.push(next);
    }
  }
  const cyclic = tasks.map((t) => t.id).filter((id) => !order.includes(id));
  return { order, cyclic };
}

// ---------------------------------------------------------------------------
// Alert planning
// ---------------------------------------------------------------------------

/** Build the concrete alert instants for a task's planned sessions. */
export function buildAlertPlan(task: Task, sessions: readonly PlannedSession[]): TaskAlertPlan[] {
  const cfg = task.alert;
  if (!cfg || !cfg.enabled) return [];
  const plans: TaskAlertPlan[] = [];
  for (const s of sessions) {
    const times = new Set<number>();
    if (cfg.offsetBeforeMin && cfg.offsetBeforeMin > 0) times.add(s.startMs - cfg.offsetBeforeMin * MS_PER_MINUTE);
    if (cfg.atStart) times.add(s.startMs);
    if (cfg.atEnd) times.add(s.endMs);
    if (cfg.repeatCount && cfg.repeatCount > 0 && cfg.repeatIntervalMin && cfg.repeatIntervalMin > 0) {
      for (let i = 1; i <= cfg.repeatCount; i += 1) {
        times.add(s.startMs + i * cfg.repeatIntervalMin * MS_PER_MINUTE);
      }
    }
    plans.push({ sessionIndex: s.index, atMs: [...times].sort((a, b) => a - b), config: cfg });
  }
  return plans;
}
