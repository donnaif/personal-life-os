import { ApiError, request } from './client';
import type {
  AuthUser,
  Habit,
  HabitLog,
  HabitStreak,
  PlanTaskResult,
  ReportSummary,
  SchedulePlanResult,
  Session,
  Task,
  TokenResponse,
  UserSettings,
} from './types';

export interface TaskInput {
  title: string;
  description?: string;
  priority?: number;
  status?: string;
  dueAt?: string;
  windowStart?: string;
  windowEnd?: string;
  estimatedDurationMin?: number;
  sessionDurationMin?: number;
  sessionCount?: number;
  sessionIntervalMin?: number;
  intervalAnchor?: 'start' | 'end';
  notes?: string;
  autoComplete?: boolean;
}

export interface HabitInput {
  title: string;
  description?: string;
  targetCount?: number;
  targetPeriod?: 'day' | 'week' | 'month';
}

/* ------------------------------- auth ------------------------------- */

export const authApi = {
  register: (email: string, password: string, name?: string) =>
    request<TokenResponse>('/auth/register', { method: 'POST', body: { email, password, name }, auth: false }),
  login: (email: string, password: string) =>
    request<TokenResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request<AuthUser>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
};

/* ----------------------------- settings ----------------------------- */

export const settingsApi = {
  get: () => request<UserSettings>('/settings'),
  update: (settings: Omit<UserSettings, 'userId' | 'updatedAt' | 'version'>) =>
    request<UserSettings>('/settings', { method: 'PUT', body: settings }),
};

/* ------------------------------- tasks ------------------------------ */

export const tasksApi = {
  list: (opts: { includeDeleted?: boolean; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.includeDeleted) q.set('includeDeleted', 'true');
    if (opts.status) q.set('status', opts.status);
    const qs = q.toString();
    return request<Task[]>(`/tasks${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<Task>(`/tasks/${id}`),
  create: (input: TaskInput) => request<Task>('/tasks', { method: 'POST', body: input }),
  update: (id: string, input: Partial<TaskInput> & { status?: string }) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
  sessions: (id: string) => request<Session[]>(`/tasks/${id}/sessions`),
  plan: (id: string) => request<PlanTaskResult>(`/tasks/${id}/plan`, { method: 'POST' }),
};

/* ----------------------------- sessions ----------------------------- */

export type SessionAction = 'start' | 'pause' | 'resume' | 'complete' | 'cancel';

export const sessionsApi = {
  list: (fromIso?: string, toIso?: string) => {
    const q = new URLSearchParams();
    if (fromIso) q.set('from', fromIso);
    if (toIso) q.set('to', toIso);
    const qs = q.toString();
    return request<Session[]>(`/sessions${qs ? `?${qs}` : ''}`);
  },
  act: (id: string, action: SessionAction, reason?: string) =>
    request<Session>(`/sessions/${id}/${action}`, { method: 'POST', body: reason ? { reason } : {} }),
};

/* ---------------------------- scheduling ---------------------------- */

export const scheduleApi = {
  plan: (persist: boolean) => request<SchedulePlanResult>('/schedule/plan', { method: 'POST', body: { persist } }),
};

/* ------------------------------ habits ------------------------------ */

export const habitsApi = {
  list: (includeArchived = false) =>
    request<Habit[]>(`/habits${includeArchived ? '?includeArchived=true' : ''}`),
  create: (input: HabitInput) => request<Habit>('/habits', { method: 'POST', body: input }),
  update: (id: string, input: Partial<HabitInput>) =>
    request<Habit>(`/habits/${id}`, { method: 'PATCH', body: input }),
  archive: (id: string) => request<{ ok: boolean }>(`/habits/${id}`, { method: 'DELETE' }),
  log: (id: string, date: string, completed: boolean, count: number) =>
    request<HabitLog>(`/habits/${id}/log`, { method: 'POST', body: { date, completed, count } }),
  streak: (id: string) => request<HabitStreak>(`/habits/${id}/streak`),
};

/* ------------------------------ reports ----------------------------- */

export const reportsApi = {
  summary: (fromIso?: string, toIso?: string) => {
    const q = new URLSearchParams();
    if (fromIso) q.set('from', fromIso);
    if (toIso) q.set('to', toIso);
    const qs = q.toString();
    return request<ReportSummary>(`/reports/summary${qs ? `?${qs}` : ''}`);
  },
};

export { ApiError };
