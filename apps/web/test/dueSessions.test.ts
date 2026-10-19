import { describe, expect, it } from 'vitest';
import type { Session } from '../src/api/types';
import { selectDueSessions } from '../src/lib/dueSessions';

const NOW = new Date('2026-03-10T09:00:00.000Z');

function makeSession(id: string, taskId: string, offsetMinutes: number, status: Session['status'] = 'planned'): Session {
  const start = new Date(NOW.getTime() + offsetMinutes * 60_000);
  return {
    id,
    userId: 'u1',
    taskId,
    index: 0,
    status,
    plannedStartAt: start.toISOString(),
    plannedEndAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
    plannedDurationMin: 30,
    pausedAccumulatedMs: 0,
    updatedAt: start.toISOString(),
    version: 1,
  };
}

describe('selectDueSessions', () => {
  it('returns planned sessions that start inside the lead window', () => {
    const sessions = [makeSession('s1', 't1', 5), makeSession('s2', 't1', 30), makeSession('s3', 't2', -3)];
    const due = selectDueSessions(sessions, { now: NOW });
    expect(due.map((entry) => entry.id)).toEqual(['s1']);
    expect(due[0]!.title).toBe('مهمة');
  });

  it('resolves task titles and keeps the soonest first', () => {
    const titles = new Map([
      ['t1', 'مراجعة العقد'],
      ['t2', 'كتابة التقرير'],
    ]);
    const sessions = [makeSession('s1', 't1', 8), makeSession('s2', 't2', 2)];
    const due = selectDueSessions(sessions, { now: NOW, titles });
    expect(due.map((entry) => entry.title)).toEqual(['كتابة التقرير', 'مراجعة العقد']);
    expect(due[0]!.startAt).toBe(sessions[1]!.plannedStartAt);
  });

  it('ignores sessions that are not planned or already started', () => {
    const sessions = [
      makeSession('s1', 't1', -1),
      makeSession('s2', 't1', 4, 'running'),
      makeSession('s3', 't1', 6, 'completed'),
      makeSession('s4', 't1', 0),
    ];
    const due = selectDueSessions(sessions, { now: NOW });
    expect(due.map((entry) => entry.id)).toEqual(['s4']);
  });

  it('honours the lead window and the burst limit', () => {
    const sessions = Array.from({ length: 6 }, (_, i) => makeSession(`s${i}`, 't1', i + 1));
    expect(selectDueSessions(sessions, { now: NOW, leadMinutes: 60 })).toHaveLength(3);
    expect(selectDueSessions(sessions, { now: NOW, leadMinutes: 2, limit: 5 })).toHaveLength(2);
  });

  it('blank titles fall back to a neutral label', () => {
    const sessions = [makeSession('s1', 't1', 3)];
    const due = selectDueSessions(sessions, { now: NOW, titles: new Map([['t1', '   ']]) });
    expect(due[0]!.title).toBe('مهمة');
  });
});
