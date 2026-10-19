import { describe, expect, it } from 'vitest';
import {
  notificationText,
  sanitizeDueSessions,
  selectNotifiableSessions,
  type DueSession,
} from '../src/notifications.js';

const NOW = new Date('2026-03-10T09:00:00.000Z');
const id = (n: number) => `session-${n}`;

function session(n: number, offsetMinutes: number, title = `مهمة ${n}`): DueSession {
  return {
    id: id(n),
    title,
    startAt: new Date(NOW.getTime() + offsetMinutes * 60_000).toISOString(),
  };
}

describe('notification selection', () => {
  it('shows nothing unless the user opted in', () => {
    expect(selectNotifiableSessions([session(1, 5)], { enabled: false, already: new Set(), now: NOW })).toEqual([]);
  });

  it('keeps only sessions inside the lead window', () => {
    const due = [session(1, -30), session(2, 5), session(3, 30)];
    const picked = selectNotifiableSessions(due, { enabled: true, already: new Set(), now: NOW });
    expect(picked.map((s) => s.id)).toEqual([id(2)]);
  });

  it('still fires just after the start time, but not for long-past sessions', () => {
    const fresh = selectNotifiableSessions([session(1, -2)], { enabled: true, already: new Set(), now: NOW });
    expect(fresh.map((s) => s.id)).toEqual([id(1)]);
    const stale = selectNotifiableSessions([session(1, -20)], { enabled: true, already: new Set(), now: NOW });
    expect(stale).toEqual([]);
  });

  it('ignores sessions that went stale while the app was closed', () => {
    const due = [session(1, -30), session(2, 3)];
    const picked = selectNotifiableSessions(due, { enabled: true, already: new Set(), now: NOW });
    expect(picked.map((s) => s.id)).toEqual([id(2)]);
  });

  it('never notifies the same session twice', () => {
    const due = [session(1, 2), session(2, 4)];
    const picked = selectNotifiableSessions(due, { enabled: true, already: new Set([id(1)]), now: NOW });
    expect(picked.map((s) => s.id)).toEqual([id(2)]);
  });

  it('orders by start time and caps the burst', () => {
    const due = [session(1, 9), session(2, 1), session(3, 5), session(4, 3), session(5, 7)];
    const picked = selectNotifiableSessions(due, { enabled: true, already: new Set(), now: NOW });
    expect(picked.map((s) => s.id)).toEqual([id(2), id(4), id(3)]);
  });

  it('ignores malformed entries coming from the renderer', () => {
    const due = [
      { id: '', title: 'x', startAt: NOW.toISOString() },
      { id: 'a', title: 'x', startAt: 'not-a-date' },
      { id: 'b', title: 'ok', startAt: new Date(NOW.getTime() + 60_000).toISOString() },
    ] as DueSession[];
    const picked = selectNotifiableSessions(due, { enabled: true, already: new Set(), now: NOW });
    expect(picked.map((s) => s.id)).toEqual(['b']);
  });
});

describe('due session sanitizing', () => {
  it('rejects junk and trims titles', () => {
    const raw = [
      null,
      'nope',
      { id: 'a', title: '   ', startAt: new Date(NOW.getTime() + 60_000).toISOString() },
      { id: 'b', title: '  عنوان طويل  ', startAt: '2026-03-10T09:05:00.000Z' },
      { id: 'c', title: 'bad date', startAt: 'nope' },
      { id: 'd', title: 'x'.repeat(500), startAt: new Date(NOW.getTime() + 60_000).toISOString() },
    ];
    const out = sanitizeDueSessions(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'a', title: 'مهمة' });
    expect(out[1]).toMatchObject({ id: 'b', title: 'عنوان طويل' });
    expect(out[2]!.title.length).toBe(120);
  });

  it('caps the payload size', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `s-${i}`,
      title: 'x',
      startAt: new Date(NOW.getTime() + 60_000).toISOString(),
    }));
    expect(sanitizeDueSessions(many)).toHaveLength(20);
    expect(sanitizeDueSessions('nope')).toEqual([]);
  });
});

describe('notification text', () => {
  it('formats arabic text with a fixed timezone', () => {
    const text = notificationText(session(1, 0), 'ar', 'UTC');
    expect(text.title).toBe('جلسة على وشك البدء');
    expect(text.body).toContain('مهمة 1');
    expect(text.body).toMatch(/09:00/);
  });

  it('formats english text', () => {
    const text = notificationText(session(2, 0, 'Write report'), 'en', 'UTC');
    expect(text.title).toBe('Session starting soon');
    expect(text.body).toBe('Write report — starts at 09:00');
  });
});
