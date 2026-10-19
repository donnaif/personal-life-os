import type { Session } from '../api/types';

/**
 * Elapsed working milliseconds — recomputed from stored timestamps so the
 * displayed timer can never drift, matching the server-side rule in
 * `@lifeos/core/sessions.ts`.
 */
export function elapsedMs(session: Session, nowMs: number): number {
  if (!session.startedAt) return 0;
  const started = Date.parse(session.startedAt);
  let elapsed = nowMs - started - (session.pausedAccumulatedMs || 0);
  if (session.status === 'paused' && session.lastPausedAt) {
    elapsed -= nowMs - Date.parse(session.lastPausedAt);
  }
  return Math.max(0, elapsed);
}

export function progressOf(session: Session, nowMs: number): number {
  const planned = session.plannedDurationMin * 60_000;
  if (planned <= 0) return 0;
  return Math.min(1, elapsedMs(session, nowMs) / planned);
}

export function remainingMs(session: Session, nowMs: number): number {
  return Math.max(0, session.plannedDurationMin * 60_000 - elapsedMs(session, nowMs));
}
