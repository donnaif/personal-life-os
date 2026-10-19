/**
 * Wire types — mirror the JSON actually returned by `apps/api`.
 * These are intentionally a local copy, not an import from `@lifeos/core`,
 * so the browser bundle stays free of backend-only dependencies.
 */

export type TaskStatus =
  | 'not_started'
  | 'scheduled'
  | 'ready'
  | 'in_progress'
  | 'paused'
  | 'deferred'
  | 'completed'
  | 'cancelled';

export type SessionStatus = 'planned' | 'running' | 'paused' | 'completed' | 'cancelled' | 'missed';
export type Priority = 1 | 2 | 3 | 4 | 5;
export type IntervalAnchor = 'start' | 'end';

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
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  plannedStartAt?: string;
  completedAt?: string;
  windowStart?: string;
  windowEnd?: string;
  estimatedDurationMin?: number;
  actualDurationMin?: number;
  sessionDurationMin?: number;
  sessionCount?: number;
  sessionIntervalMin?: number;
  intervalAnchor?: IntervalAnchor;
  notes?: string;
  dependsOn?: string[];
  autoComplete?: boolean;
  deletedAt?: string | null;
  version: number;
}

export interface Session {
  id: string;
  userId: string;
  taskId: string;
  index: number;
  status: SessionStatus;
  plannedStartAt: string;
  plannedEndAt: string;
  plannedDurationMin: number;
  startedAt?: string;
  endedAt?: string;
  actualDurationMin?: number;
  pausedAccumulatedMs: number;
  lastPausedAt?: string;
  notes?: string;
  cancelReason?: string;
  updatedAt: string;
  version: number;
}

export interface Habit {
  id: string;
  userId: string;
  title: string;
  description?: string;
  weekdays?: number[];
  targetCount: number;
  targetPeriod: 'day' | 'week' | 'month';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  version: number;
}

export interface HabitLog {
  id: string;
  userId: string;
  habitId: string;
  date: string;
  completed: boolean;
  count: number;
  note?: string;
  updatedAt: string;
  version: number;
}

export interface HabitStreak {
  current: number;
  longest: number;
}

export interface UserSettings {
  userId: string;
  timezone: string;
  locale: 'ar' | 'en';
  theme: 'light' | 'dark' | 'system';
  availability: Array<{ weekday: number; windows: Array<{ startMin: number; endMin: number }> }>;
  quietHours: Array<{ startMin: number; endMin: number }>;
  defaultSessionDurationMin: number;
  defaultBreakMin: number;
  allowOverlap: boolean;
  minLeadTimeMin: number;
  updatedAt: string;
  version: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface TaskSummary {
  total: number;
  byStatus: Record<TaskStatus, number>;
  overdue: number;
  completed: number;
  completionRate: number;
}

export interface SessionSummary {
  total: number;
  byStatus: Record<SessionStatus, number>;
  totalPlannedMin: number;
  totalActualMin: number;
  avgActualMin: number;
  efficiency: number;
}

export interface DayPoint {
  date: string;
  actualMin: number;
  plannedMin: number;
  sessions: number;
  completedSessions: number;
}

export interface CategoryTime {
  categoryId: string | null;
  actualMin: number;
  plannedMin: number;
  sessions: number;
}

export interface ReportSummary {
  tasks: TaskSummary;
  sessions: SessionSummary;
  byCategory: CategoryTime[];
  daily: DayPoint[];
}

export interface ScheduleConflict {
  taskId: string;
  unplacedSessions: number;
  reason: 'no_capacity' | 'window_too_small' | 'horizon_exceeded' | 'dependency_blocked';
  detail?: string;
}

export interface PlannedSlot {
  taskId: string;
  index: number;
  startAt: string;
  endAt: string;
  durationMin: number;
}

export interface SchedulePlanResult {
  results: Array<{ taskId: string; sessions: PlannedSlot[] }>;
  conflicts: ScheduleConflict[];
}

export interface PlanTaskResult {
  sessions: Session[];
  conflicts: ScheduleConflict[];
  alerts: unknown[];
}
