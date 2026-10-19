import { describe, expect, it } from 'vitest';
import {
  adjustSessionDuration,
  cancelSession,
  completeSession,
  deriveActualMinutes,
  markSessionMissed,
  pauseSession,
  reconcileOnResume,
  resumeSession,
  SessionTransitionError,
  sessionElapsedMs,
  sessionProgress,
  sessionRemainingMs,
  startSession,
} from './sessions.js';
import type { Session } from './types.js';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const MIN = 60_000;

function sess(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    userId: 'u1',
    taskId: 't1',
    index: 0,
    status: 'planned',
    plannedStartAt: new Date(T0).toISOString(),
    plannedEndAt: new Date(T0 + 30 * MIN).toISOString(),
    plannedDurationMin: 30,
    pausedAccumulatedMs: 0,
    updatedAt: new Date(T0).toISOString(),
    version: 1,
    ...over,
  };
}

describe('timer is drift resistant', () => {
  it('computes elapsed from timestamps, not a tick counter', () => {
    const running = startSession(sess(), T0);
    expect(sessionElapsedMs(running, T0 + 10 * MIN)).toBe(10 * MIN);
    // App was suspended for 30 minutes and reopened — elapsed is still correct.
    expect(sessionElapsedMs(running, T0 + 30 * MIN)).toBe(30 * MIN);
  });

  it('excludes paused time on resume', () => {
    let s = startSession(sess(), T0);
    s = pauseSession(s, T0 + 30 * MIN);
    s = resumeSession(s, T0 + 40 * MIN);
    expect(sessionElapsedMs(s, T0 + 50 * MIN)).toBe(40 * MIN);
  });

  it('reports remaining and progress', () => {
    const s = startSession(sess({ plannedDurationMin: 20 }), T0);
    expect(sessionRemainingMs(s, T0 + 5 * MIN)).toBe(15 * MIN);
    expect(sessionProgress(s, T0 + 10 * MIN)).toBeCloseTo(0.5, 3);
    expect(sessionRemainingMs(s, T0 + 100 * MIN)).toBe(0);
  });

  it('reconciles a running session whose timer elapsed while away', () => {
    const s = startSession(sess({ plannedDurationMin: 10 }), T0);
    const rec = reconcileOnResume(s, T0 + 60 * MIN);
    expect(rec.status).toBe('running'); // NOT auto-completed
  });
});

describe('session state transitions', () => {
  it('rejects illegal transitions', () => {
    const planned = sess();
    expect(() => pauseSession(planned, T0)).toThrow(SessionTransitionError);
    const done = completeSession(startSession(sess(), T0), T0 + 30 * MIN);
    expect(() => startSession(done, T0 + 31 * MIN)).toThrow(SessionTransitionError);
  });

  it('completes and records actual duration', () => {
    const s = completeSession(startSession(sess(), T0), T0 + 25 * MIN);
    expect(s.status).toBe('completed');
    expect(s.actualDurationMin).toBe(25);
    expect(s.endedAt).toBe(new Date(T0 + 25 * MIN).toISOString());
  });

  it('cancels with a reason and marks missed from planned', () => {
    const c = cancelSession(startSession(sess(), T0), T0 + 5 * MIN, 'user requested');
    expect(c.status).toBe('cancelled');
    expect(c.cancelReason).toBe('user requested');
    const m = markSessionMissed(sess(), T0 + 40 * MIN);
    expect(m.status).toBe('missed');
  });

  it('extends and shortens planned duration, keeping end consistent', () => {
    const ext = adjustSessionDuration(sess(), 15, T0);
    expect(ext.plannedDurationMin).toBe(45);
    expect(Date.parse(ext.plannedEndAt) - Date.parse(ext.plannedStartAt)).toBe(45 * MIN);
    const sh = adjustSessionDuration(sess(), -10, T0);
    expect(sh.plannedDurationMin).toBe(20);
  });
});

describe('derived totals', () => {
  it('sums actual minutes once per session', () => {
    const s1 = completeSession(startSession(sess({ id: 'a' }), T0), T0 + 20 * MIN);
    const s2 = completeSession(startSession(sess({ id: 'b' }), T0), T0 + 30 * MIN);
    const running = startSession(sess({ id: 'c' }), T0);
    expect(deriveActualMinutes([s1, s2, running], T0 + 10 * MIN)).toBe(60); // 20 + 30 + 10
  });

  it('ignores planned/cancelled/missed', () => {
    expect(deriveActualMinutes([sess(), cancelSession(sess({ id: 'x' }), T0 + MIN)], T0)).toBe(0);
  });
});
