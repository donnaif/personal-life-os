/**
 * Work sessions and the drift-resistant timer.
 *
 * The timer never counts down second by second. It always recomputes elapsed
 * time from persisted timestamps, so app suspension / process kill / clock
 * jumps cannot corrupt state. Finishing a timer NEVER auto-completes a task
 * unless `task.autoComplete` is explicitly true (handled by callers).
 */
import type { Session, SessionStatus } from './types.js';
import { MS_PER_MINUTE } from './time.js';

export class SessionTransitionError extends Error {}

const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  planned: ['running', 'cancelled', 'missed'],
  running: ['paused', 'completed', 'cancelled'],
  paused: ['running', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
  missed: ['running', 'cancelled'],
};

function transition(session: Session, next: SessionStatus, nowMs: number): Session {
  if (!ALLOWED[session.status].includes(next)) {
    throw new SessionTransitionError(`Illegal session transition ${session.status} -> ${next}`);
  }
  return { ...session, status: next, updatedAt: new Date(nowMs).toISOString(), version: session.version + 1 };
}

/** Elapsed working milliseconds, excluding accumulated pause time. */
export function sessionElapsedMs(session: Session, nowMs: number): number {
  if (!session.startedAt) return 0;
  const started = Date.parse(session.startedAt);
  let elapsed = nowMs - started - (session.pausedAccumulatedMs || 0);
  if (session.status === 'paused' && session.lastPausedAt) {
    elapsed -= nowMs - Date.parse(session.lastPausedAt);
  }
  return Math.max(0, elapsed);
}

/** Elapsed time clamped to the planned duration (for progress display). */
export function sessionElapsedClampedMs(session: Session, nowMs: number): number {
  const plannedMs = session.plannedDurationMin * MS_PER_MINUTE;
  return Math.min(sessionElapsedMs(session, nowMs), plannedMs);
}

/** Remaining milliseconds until the planned end (>= 0). */
export function sessionRemainingMs(session: Session, nowMs: number): number {
  const plannedMs = session.plannedDurationMin * MS_PER_MINUTE;
  return Math.max(0, plannedMs - sessionElapsedMs(session, nowMs));
}

export function sessionProgress(session: Session, nowMs: number): number {
  const plannedMs = session.plannedDurationMin * MS_PER_MINUTE;
  if (plannedMs <= 0) return 0;
  return Math.min(1, sessionElapsedMs(session, nowMs) / plannedMs);
}

/** Whether the planned window has fully elapsed (timer reached zero). */
export function sessionTimerElapsed(session: Session, nowMs: number): boolean {
  return sessionRemainingMs(session, nowMs) === 0 && session.status !== 'planned';
}

export function startSession(session: Session, nowMs: number): Session {
  const next = transition(session, 'running', nowMs);
  next.startedAt = session.startedAt ?? new Date(nowMs).toISOString();
  return next;
}

export function pauseSession(session: Session, nowMs: number): Session {
  const next = transition(session, 'paused', nowMs);
  next.lastPausedAt = new Date(nowMs).toISOString();
  return next;
}

export function resumeSession(session: Session, nowMs: number): Session {
  const next = transition(session, 'running', nowMs);
  if (session.lastPausedAt) {
    next.pausedAccumulatedMs =
      (session.pausedAccumulatedMs || 0) + (nowMs - Date.parse(session.lastPausedAt));
  }
  next.lastPausedAt = undefined;
  return next;
}

export function completeSession(session: Session, nowMs: number): Session {
  const next = transition(session, 'completed', nowMs);
  next.endedAt = new Date(nowMs).toISOString();
  next.actualDurationMin = Math.round((sessionElapsedMs(session, nowMs) / MS_PER_MINUTE) * 100) / 100;
  next.lastPausedAt = undefined;
  return next;
}

export function cancelSession(session: Session, nowMs: number, reason?: string): Session {
  const next = transition(session, 'cancelled', nowMs);
  next.endedAt = new Date(nowMs).toISOString();
  if (reason) next.cancelReason = reason;
  return next;
}

export function markSessionMissed(session: Session, nowMs: number): Session {
  return transition(session, 'missed', nowMs);
}

/** Extend (positive) or shorten (negative) the planned duration. */
export function adjustSessionDuration(session: Session, deltaMin: number, nowMs: number): Session {
  const nextDuration = Math.max(1, Math.round(session.plannedDurationMin + deltaMin));
  return {
    ...session,
    plannedDurationMin: nextDuration,
    plannedEndAt: new Date(Date.parse(session.plannedStartAt) + nextDuration * MS_PER_MINUTE).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    version: session.version + 1,
  };
}

export function extendSession(session: Session, extraMin: number, nowMs: number): Session {
  return adjustSessionDuration(session, Math.abs(extraMin), nowMs);
}

export function shortenSession(session: Session, lessMin: number, nowMs: number): Session {
  return adjustSessionDuration(session, -Math.abs(lessMin), nowMs);
}

/**
 * Total actual minutes contributed by a set of sessions.
 * Running sessions count elapsed-so-far; completed count stored actual;
 * planned/cancelled/missed contribute 0. Sessions are counted once each.
 */
export function deriveActualMinutes(sessions: readonly Session[], nowMs: number): number {
  let total = 0;
  for (const s of sessions) {
    if (s.status === 'completed') total += s.actualDurationMin ?? 0;
    else if (s.status === 'running' || s.status === 'paused') total += sessionElapsedMs(s, nowMs) / MS_PER_MINUTE;
  }
  return Math.round(total * 100) / 100;
}

/** Recompute a session's live status after the app was suspended / relaunched. */
export function reconcileOnResume(session: Session, nowMs: number): Session {
  if (session.status === 'running' && sessionTimerElapsed(session, nowMs)) {
    // Timer hit zero while the app was away — flag for user confirmation,
    // do NOT auto-complete.
    return { ...session, updatedAt: new Date(nowMs).toISOString() };
  }
  return session;
}
