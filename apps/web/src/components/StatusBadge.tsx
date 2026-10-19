import { Badge } from './ui';
import type { SessionStatus, TaskStatus } from '../api/types';

const TASK_LABEL: Record<TaskStatus, string> = {
  not_started: 'لم تبدأ',
  scheduled: 'مجدولة',
  ready: 'جاهزة',
  in_progress: 'قيد التنفيذ',
  paused: 'متوقفة',
  deferred: 'مؤجلة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const TASK_TONE: Record<TaskStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'> = {
  not_started: 'neutral',
  scheduled: 'info',
  ready: 'info',
  in_progress: 'accent',
  paused: 'warn',
  deferred: 'warn',
  completed: 'ok',
  cancelled: 'danger',
};

const SESSION_LABEL: Record<SessionStatus, string> = {
  planned: 'مخططة',
  running: 'جارية',
  paused: 'متوقفة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  missed: 'فائتة',
};

const SESSION_TONE: Record<SessionStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'> = {
  planned: 'neutral',
  running: 'accent',
  paused: 'warn',
  completed: 'ok',
  cancelled: 'danger',
  missed: 'danger',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={TASK_TONE[status]}>{TASK_LABEL[status]}</Badge>;
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <Badge tone={SESSION_TONE[status]}>{SESSION_LABEL[status]}</Badge>;
}

export const PRIORITY_LABEL: Record<number, string> = {
  1: 'عاجلة جدًا',
  2: 'عالية',
  3: 'عادية',
  4: 'منخفضة',
  5: 'منخفضة جدًا',
};

export function PriorityBadge({ priority }: { priority: number }) {
  const tone = priority <= 1 ? 'danger' : priority === 2 ? 'warn' : 'neutral';
  return <Badge tone={tone}>{PRIORITY_LABEL[priority] ?? 'عادية'}</Badge>;
}
