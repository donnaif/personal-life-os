/**
 * Core domain types for Personal Life OS.
 * Pure data structures — no framework, no I/O.
 */

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  'not_started',
  'scheduled',
  'ready',
  'in_progress',
  'paused',
  'deferred',
  'completed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];

export const SESSION_STATUSES = [
  'planned',
  'running',
  'paused',
  'completed',
  'cancelled',
  'missed',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type Priority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type Locale = 'ar' | 'en';
export type Theme = 'light' | 'dark' | 'system';

/** Anchor used to compute the gap between consecutive sessions. */
export type IntervalAnchor = 'start' | 'end';

// ---------------------------------------------------------------------------
// Time primitives
// ---------------------------------------------------------------------------

/** A wall-clock range within a day: minutes from local midnight, [start, end). */
export interface LocalTimeRange {
  startMin: number;
  endMin: number;
}

/** Availability windows for a given weekday. */
export interface DayAvailability {
  weekday: Weekday;
  windows: LocalTimeRange[];
}

/** A closed interval on the absolute (UTC) timeline, half-open [startMs, endMs). */
export interface TimeInterval {
  startMs: number;
  endMs: number;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'interval';
export type IntervalUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Step size (every N units / days / weeks / months). */
  interval?: number;
  /** Unit for `frequency: 'interval'`. */
  intervalUnit?: IntervalUnit;
  /** For weekly recurrence: which weekdays. */
  byWeekdays?: Weekday[];
  /** For monthly recurrence: which days of month (1-31). */
  byMonthDay?: number[];
  /** Inclusive local date (YYYY-MM-DD) when the rule starts applying. */
  startDate?: string;
  /** Inclusive local date (YYYY-MM-DD) after which the rule stops. */
  endDate?: string;
  /** Maximum number of occurrences. */
  count?: number;
  /** Dates (YYYY-MM-DD) explicitly allowed to be skipped without breaking history. */
  skipDates?: string[];
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertChannel = 'local' | 'push';

export interface AlertConfig {
  enabled: boolean;
  /** Minutes before the session start to fire the pre-alert (optional). */
  offsetBeforeMin?: number;
  /** Fire at the moment the session starts. */
  atStart: boolean;
  /** Fire at the moment the session ends. */
  atEnd: boolean;
  /** Number of follow-up reminders after the primary alert. */
  repeatCount?: number;
  /** Gap (minutes) between follow-up reminders. */
  repeatIntervalMin?: number;
  /** Sound identifier; null = silent. */
  sound?: string | null;
  soundEnabled: boolean;
  /** Snooze duration (minutes) offered on the alert. */
  snoozeMinutes?: number;
  channels?: AlertChannel[];
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type DeferralStrategy = 'ask' | 'shift_session' | 'shift_all' | 'next_free';

export interface DeferralPolicy {
  strategy: DeferralStrategy;
  /** Respect quiet hours when proposing a new time. */
  respectQuietHours: boolean;
}

/** A notification plan entry produced by the scheduler for a task/session. */
export interface TaskAlertPlan {
  sessionIndex: number;
  /** Absolute instants at which to alert. */
  atMs: number[];
  config: AlertConfig;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description?: string;
  categoryId?: string;

  status: TaskStatus;
  priority: Priority;
  importance?: Priority;
  urgency?: Priority;

  /** Absolute ISO timestamps (UTC). */
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  plannedStartAt?: string;
  completedAt?: string;

  /** Local time-of-day window [HH:mm, HH:mm) within which sessions may be placed. */
  windowStart?: string;
  windowEnd?: string;

  /** Total estimated work in minutes. */
  estimatedDurationMin?: number;
  /** Actual accumulated work in minutes (derived from sessions when available). */
  actualDurationMin?: number;

  /** Per-session length in minutes. */
  sessionDurationMin?: number;
  /** Requested number of sessions (if omitted, derived from estimate/session length). */
  sessionCount?: number;
  /** Gap between sessions in minutes. */
  sessionIntervalMin?: number;
  /** Whether the gap is measured from session start or session end. */
  intervalAnchor?: IntervalAnchor;

  recurrence?: RecurrenceRule;
  alert?: AlertConfig;
  deferralPolicy?: DeferralPolicy;

  notes?: string;
  /** Ids of tasks that must be completed before this one may start. */
  dependsOn?: string[];
  /** Whether finishing the last session auto-marks the task completed. */
  autoComplete?: boolean;

  /** Soft-delete marker. */
  deletedAt?: string | null;
  /** Monotonic sync version; incremented on every mutation. */
  version: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  userId: string;
  taskId: string;
  /** 0-based index of this session within its task. */
  index: number;

  status: SessionStatus;

  plannedStartAt: string;
  plannedEndAt: string;
  plannedDurationMin: number;

  startedAt?: string;
  endedAt?: string;
  actualDurationMin?: number;

  /** Accumulated paused time in milliseconds. */
  pausedAccumulatedMs: number;
  /** Instant when the session was last paused (if currently paused). */
  lastPausedAt?: string;

  notes?: string;
  /** Reason recorded when the session is cancelled/deferred. */
  cancelReason?: string;

  updatedAt: string;
  version: number;
}

/** A computed, placement-only session slot (not yet persisted). */
export interface PlannedSession {
  taskId: string;
  index: number;
  startMs: number;
  endMs: number;
  durationMin: number;
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export type HabitTargetPeriod = 'day' | 'week' | 'month';

export interface Habit {
  id: string;
  userId: string;
  title: string;
  description?: string;
  /** Optional set of allowed weekdays (undefined = every day). */
  weekdays?: Weekday[];
  targetCount: number;
  targetPeriod: HabitTargetPeriod;
  recurrence?: RecurrenceRule;
  skipDates?: string[];
  restDates?: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  version: number;
}

export interface HabitLog {
  id: string;
  userId: string;
  habitId: string;
  /** Local date YYYY-MM-DD. */
  date: string;
  completed: boolean;
  count: number;
  note?: string;
  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

export interface UserSettings {
  userId: string;
  timezone: string;
  locale: Locale;
  theme: Theme;

  availability: DayAvailability[];
  quietHours: LocalTimeRange[];

  defaultSessionDurationMin: number;
  defaultBreakMin: number;
  allowOverlap: boolean;

  /** Wait n minutes before the scheduler may place a session from "now". */
  minLeadTimeMin: number;

  quietMode?: boolean;

  updatedAt: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Scheduling inputs/outputs
// ---------------------------------------------------------------------------

export interface ScheduleConflict {
  taskId: string;
  /** How many sessions could not be placed. */
  unplacedSessions: number;
  reason: 'no_capacity' | 'window_too_small' | 'horizon_exceeded' | 'dependency_blocked';
  detail?: string;
}

export interface TaskPlanResult {
  taskId: string;
  sessions: PlannedSession[];
  conflicts: ScheduleConflict[];
}
