import type { Habit, HabitLog, Session, Task } from '@lifeos/core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const j = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const pj = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string' || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export function taskToParams(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    user_id: t.userId,
    title: t.title,
    description: t.description ?? null,
    category_id: t.categoryId ?? null,
    status: t.status,
    priority: t.priority,
    importance: t.importance ?? null,
    urgency: t.urgency ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    due_at: t.dueAt ?? null,
    planned_start_at: t.plannedStartAt ?? null,
    completed_at: t.completedAt ?? null,
    window_start: t.windowStart ?? null,
    window_end: t.windowEnd ?? null,
    estimated_duration_min: t.estimatedDurationMin ?? null,
    actual_duration_min: t.actualDurationMin ?? null,
    session_duration_min: t.sessionDurationMin ?? null,
    session_count: t.sessionCount ?? null,
    session_interval_min: t.sessionIntervalMin ?? null,
    interval_anchor: t.intervalAnchor ?? null,
    recurrence_json: j(t.recurrence),
    alert_json: j(t.alert),
    deferral_json: j(t.deferralPolicy),
    notes: t.notes ?? null,
    depends_on_json: j(t.dependsOn),
    auto_complete: t.autoComplete ? 1 : 0,
    deleted_at: t.deletedAt ?? null,
    version: t.version,
  };
}

export function rowToTask(r: Row): Task {
  const task: Task = {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
    autoComplete: r.auto_complete === 1,
  };
  if (r.description != null) task.description = r.description;
  if (r.category_id != null) task.categoryId = r.category_id;
  if (r.importance != null) task.importance = r.importance;
  if (r.urgency != null) task.urgency = r.urgency;
  if (r.due_at != null) task.dueAt = r.due_at;
  if (r.planned_start_at != null) task.plannedStartAt = r.planned_start_at;
  if (r.completed_at != null) task.completedAt = r.completed_at;
  if (r.window_start != null) task.windowStart = r.window_start;
  if (r.window_end != null) task.windowEnd = r.window_end;
  if (r.estimated_duration_min != null) task.estimatedDurationMin = r.estimated_duration_min;
  if (r.actual_duration_min != null) task.actualDurationMin = r.actual_duration_min;
  if (r.session_duration_min != null) task.sessionDurationMin = r.session_duration_min;
  if (r.session_count != null) task.sessionCount = r.session_count;
  if (r.session_interval_min != null) task.sessionIntervalMin = r.session_interval_min;
  if (r.interval_anchor != null) task.intervalAnchor = r.interval_anchor;
  if (r.recurrence_json != null) task.recurrence = pj(r.recurrence_json, undefined as never);
  if (r.alert_json != null) task.alert = pj(r.alert_json, undefined as never);
  if (r.deferral_json != null) task.deferralPolicy = pj(r.deferral_json, undefined as never);
  if (r.notes != null) task.notes = r.notes;
  if (r.depends_on_json != null) task.dependsOn = pj<string[]>(r.depends_on_json, []);
  if (r.deleted_at != null) task.deletedAt = r.deleted_at;
  return task;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function sessionToParams(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    user_id: s.userId,
    task_id: s.taskId,
    idx: s.index,
    status: s.status,
    planned_start_at: s.plannedStartAt,
    planned_end_at: s.plannedEndAt,
    planned_duration_min: s.plannedDurationMin,
    started_at: s.startedAt ?? null,
    ended_at: s.endedAt ?? null,
    actual_duration_min: s.actualDurationMin ?? null,
    paused_accumulated_ms: s.pausedAccumulatedMs,
    last_paused_at: s.lastPausedAt ?? null,
    notes: s.notes ?? null,
    cancel_reason: s.cancelReason ?? null,
    updated_at: s.updatedAt,
    version: s.version,
  };
}

export function rowToSession(r: Row): Session {
  const s: Session = {
    id: r.id,
    userId: r.user_id,
    taskId: r.task_id,
    index: r.idx,
    status: r.status,
    plannedStartAt: r.planned_start_at,
    plannedEndAt: r.planned_end_at,
    plannedDurationMin: r.planned_duration_min,
    pausedAccumulatedMs: r.paused_accumulated_ms,
    updatedAt: r.updated_at,
    version: r.version,
  };
  if (r.started_at != null) s.startedAt = r.started_at;
  if (r.ended_at != null) s.endedAt = r.ended_at;
  if (r.actual_duration_min != null) s.actualDurationMin = r.actual_duration_min;
  if (r.last_paused_at != null) s.lastPausedAt = r.last_paused_at;
  if (r.notes != null) s.notes = r.notes;
  if (r.cancel_reason != null) s.cancelReason = r.cancel_reason;
  return s;
}

// ---------------------------------------------------------------------------
// Habit / HabitLog
// ---------------------------------------------------------------------------

export function habitToParams(h: Habit): Record<string, unknown> {
  return {
    id: h.id,
    user_id: h.userId,
    title: h.title,
    description: h.description ?? null,
    weekdays_json: j(h.weekdays),
    target_count: h.targetCount,
    target_period: h.targetPeriod,
    recurrence_json: j(h.recurrence),
    skip_dates_json: j(h.skipDates),
    rest_dates_json: j(h.restDates),
    created_at: h.createdAt,
    updated_at: h.updatedAt,
    archived_at: h.archivedAt ?? null,
    version: h.version,
  };
}

export function rowToHabit(r: Row): Habit {
  const h: Habit = {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    targetCount: r.target_count,
    targetPeriod: r.target_period,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  };
  if (r.description != null) h.description = r.description;
  if (r.weekdays_json != null) h.weekdays = pj(r.weekdays_json, undefined as never);
  if (r.recurrence_json != null) h.recurrence = pj(r.recurrence_json, undefined as never);
  if (r.skip_dates_json != null) h.skipDates = pj<string[]>(r.skip_dates_json, []);
  if (r.rest_dates_json != null) h.restDates = pj<string[]>(r.rest_dates_json, []);
  if (r.archived_at != null) h.archivedAt = r.archived_at;
  return h;
}

export function habitLogToParams(l: HabitLog): Record<string, unknown> {
  return {
    id: l.id,
    user_id: l.userId,
    habit_id: l.habitId,
    date: l.date,
    completed: l.completed ? 1 : 0,
    count: l.count,
    note: l.note ?? null,
    updated_at: l.updatedAt,
    version: l.version,
  };
}

export function rowToHabitLog(r: Row): HabitLog {
  const l: HabitLog = {
    id: r.id,
    userId: r.user_id,
    habitId: r.habit_id,
    date: r.date,
    completed: r.completed === 1,
    count: r.count,
    updatedAt: r.updated_at,
    version: r.version,
  };
  if (r.note != null) l.note = r.note;
  return l;
}
