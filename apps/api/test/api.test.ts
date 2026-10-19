import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadEnv } from '../src/env.js';

let app: FastifyInstance;
let accessToken = '';
let refreshToken = '';

const auth = () => ({ authorization: `Bearer ${accessToken}` });

beforeAll(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: ':memory:',
    JWT_SECRET: 'test-secret-0123456789abcdef',
  });
  app = await buildServer({ env });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('responds ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});

describe('auth', () => {
  it('registers the first (bootstrap) user and returns tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'Owner@Example.com', password: 'supersecret1', name: 'Owner' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('refuses a second self-registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'other@example.com', password: 'supersecret1' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('registration_closed');
  });

  it('rejects wrong credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'owner@example.com', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logs in (case-insensitive email) and refreshes tokens', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'owner@example.com', password: 'supersecret1' },
    });
    expect(login.statusCode).toBe(200);
    accessToken = login.json().accessToken;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    refreshToken = refreshed.json().refreshToken;
  });

  it('protects authenticated routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current user', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe('owner@example.com');
  });
});

describe('settings', () => {
  it('returns defaults, then persists an update with a bumped version', async () => {
    const def = await app.inject({ method: 'GET', url: '/settings', headers: auth() });
    expect(def.statusCode).toBe(200);
    expect(def.json().version).toBe(1);

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: auth(),
      payload: {
        timezone: 'Asia/Riyadh',
        locale: 'ar',
        theme: 'dark',
        availability: [{ weekday: 0, windows: [{ startMin: 480, endMin: 1200 }] }],
        quietHours: [{ startMin: 1380, endMin: 360 }],
        defaultSessionDurationMin: 45,
        defaultBreakMin: 10,
        allowOverlap: false,
        minLeadTimeMin: 0,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().timezone).toBe('Asia/Riyadh');
    expect(put.json().version).toBe(2);

    const again = await app.inject({ method: 'GET', url: '/settings', headers: auth() });
    expect(again.json().timezone).toBe('Asia/Riyadh');
  });
});

describe('tasks, planning and sessions', () => {
  let taskId = '';
  let sessionIds: string[] = [];

  it('validates task input', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks', headers: auth(), payload: { title: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('creates a task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth(),
      payload: {
        title: 'Write report',
        sessionCount: 3,
        sessionDurationMin: 30,
        sessionIntervalMin: 90,
        intervalAnchor: 'end',
        autoComplete: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    taskId = body.id;
    expect(body.status).toBe('not_started');
    expect(body.priority).toBe(3);
  });

  it('plans 3 non-overlapping sessions for the task', async () => {
    const res = await app.inject({ method: 'POST', url: `/tasks/${taskId}/plan`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(3);
    for (let i = 1; i < body.sessions.length; i += 1) {
      expect(Date.parse(body.sessions[i].plannedStartAt)).toBeGreaterThanOrEqual(
        Date.parse(body.sessions[i - 1].plannedEndAt),
      );
    }
    sessionIds = body.sessions.map((s: { id: string }) => s.id);
  });

  it('runs a session through start -> complete, then auto-completes the task', async () => {
    for (const id of sessionIds) {
      const started = await app.inject({ method: 'POST', url: `/sessions/${id}/start`, headers: auth() });
      expect(started.statusCode).toBe(200);
      expect(started.json().status).toBe('running');

      const done = await app.inject({ method: 'POST', url: `/sessions/${id}/complete`, headers: auth() });
      expect(done.statusCode).toBe(200);
      expect(done.json().status).toBe('completed');
    }
    const task = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers: auth() });
    expect(task.json().status).toBe('completed');
  });

  it('rejects illegal session transitions', async () => {
    const res = await app.inject({ method: 'POST', url: `/sessions/${sessionIds[0]}/pause`, headers: auth() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('invalid_transition');
  });

  it('plans the whole schedule without overlapping', async () => {
    await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth(),
      payload: { title: 'Errand', estimatedDurationMin: 60, sessionDurationMin: 30 },
    });
    const res = await app.inject({ method: 'POST', url: '/schedule/plan', headers: auth(), payload: {} });
    expect(res.statusCode).toBe(200);
    const tasks = res.json().results as Array<{ sessions: Array<{ startAt: string; endAt: string }> }>;
    const all = tasks.flatMap((r) => r.sessions).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    for (let i = 1; i < all.length; i += 1) {
      expect(Date.parse(all[i]!.startAt)).toBeGreaterThanOrEqual(Date.parse(all[i - 1]!.endAt));
    }
  });

  it('soft-deletes a task and hides it from the default list', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/tasks/${taskId}`, headers: auth() });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/tasks', headers: auth() });
    expect((list.json() as Array<{ id: string }>).some((t) => t.id === taskId)).toBe(false);
    const withDeleted = await app.inject({ method: 'GET', url: '/tasks?includeDeleted=true', headers: auth() });
    expect((withDeleted.json() as Array<{ id: string }>).some((t) => t.id === taskId)).toBe(true);
  });
});

describe('re-planning never double-books', () => {
  interface Span {
    plannedStartAt: string;
    plannedEndAt: string;
  }
  const overlaps = (a: Span, b: Span): boolean =>
    Date.parse(a.plannedStartAt) < Date.parse(b.plannedEndAt) &&
    Date.parse(b.plannedStartAt) < Date.parse(a.plannedEndAt);

  const createTask = async (title: string, extra: Record<string, unknown> = {}): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth(),
      payload: { title, sessionCount: 2, sessionDurationMin: 45, ...extra },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  };

  it('keeps a task clear of another task that is already planned', async () => {
    const a = await createTask('Planned first');
    const planA = await app.inject({ method: 'POST', url: `/tasks/${a}/plan`, headers: auth() });
    expect(planA.statusCode).toBe(200);
    const aSessions = planA.json().sessions as Span[];
    expect(aSessions).toHaveLength(2);

    const b = await createTask('Planned second');
    const planB = await app.inject({ method: 'POST', url: `/tasks/${b}/plan`, headers: auth() });
    expect(planB.statusCode).toBe(200);
    const bSessions = planB.json().sessions as Span[];
    expect(bSessions).toHaveLength(2);

    for (const bs of bSessions) {
      for (const as of aSessions) expect(overlaps(bs, as)).toBe(false);
    }
  });

  it('preserves completed history and books around it on a whole re-plan', async () => {
    const finished = await createTask('Finished work', { sessionCount: 1 });
    const planned = await app.inject({ method: 'POST', url: `/tasks/${finished}/plan`, headers: auth() });
    const [session] = planned.json().sessions as Array<{ id: string }>;
    expect(session).toBeTruthy();

    const started = await app.inject({ method: 'POST', url: `/sessions/${session!.id}/start`, headers: auth() });
    expect(started.statusCode).toBe(200);
    const done = await app.inject({ method: 'POST', url: `/sessions/${session!.id}/complete`, headers: auth() });
    expect(done.statusCode).toBe(200);

    const open = await createTask('Planned after completion');

    const replan = await app.inject({
      method: 'POST',
      url: '/schedule/plan',
      headers: auth(),
      payload: { persist: true },
    });
    expect(replan.statusCode).toBe(200);

    // The completed session must survive the re-plan...
    const history = await app.inject({ method: 'GET', url: `/tasks/${finished}/sessions`, headers: auth() });
    const historySessions = history.json() as Array<Span & { status: string }>;
    const completed = historySessions.filter((s) => s.status === 'completed');
    expect(completed).toHaveLength(1);

    // ...and nobody, not even the same task, may be booked over it.
    const later = await app.inject({ method: 'GET', url: `/tasks/${open}/sessions`, headers: auth() });
    const laterSessions = later.json() as Span[];
    expect(laterSessions.length).toBeGreaterThan(0);
    for (const s of laterSessions) expect(overlaps(s, completed[0]!)).toBe(false);
    for (const s of historySessions) {
      if (s.status === 'planned') expect(overlaps(s, completed[0]!)).toBe(false);
    }
  });
});

describe('habits', () => {
  let habitId = '';

  it('creates a habit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/habits',
      headers: auth(),
      payload: { title: 'Read 20 pages', targetCount: 1, targetPeriod: 'day' },
    });
    expect(res.statusCode).toBe(201);
    habitId = res.json().id;
  });

  it('logs a day and reports a streak', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const log = await app.inject({
      method: 'POST',
      url: `/habits/${habitId}/log`,
      headers: auth(),
      payload: { date: today, completed: true, count: 1 },
    });
    expect(log.statusCode).toBe(200);

    const streak = await app.inject({ method: 'GET', url: `/habits/${habitId}/streak`, headers: auth() });
    expect(streak.statusCode).toBe(200);
    expect(streak.json().current).toBe(1);
  });

  it('is idempotent for the same habit+date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: 'POST',
      url: `/habits/${habitId}/log`,
      headers: auth(),
      payload: { date: today, completed: true, count: 5 },
    });
    const logs = await app.inject({ method: 'GET', url: '/habits', headers: auth() });
    expect(logs.statusCode).toBe(200);
    const streak = await app.inject({ method: 'GET', url: `/habits/${habitId}/streak`, headers: auth() });
    expect(streak.json().current).toBe(1);
  });
});

describe('reports', () => {
  it('returns derived task and session summaries', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/summary', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks.total).toBeGreaterThan(0);
    expect(body.sessions.total).toBeGreaterThan(0);
    expect(Array.isArray(body.daily)).toBe(true);
  });
});

describe('sync', () => {
  it('deduplicates ops by opId and exposes a change stream', async () => {
    const payload = {
      deviceId: 'device-1',
      ops: [{ opId: 'op-1', entity: 'task', op: 'create', payload: { title: 'from offline' } }],
    };
    const first = await app.inject({ method: 'POST', url: '/sync/push', headers: auth(), payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().appliedCount).toBe(1);

    const second = await app.inject({ method: 'POST', url: '/sync/push', headers: auth(), payload });
    expect(second.json().appliedCount).toBe(0);
    expect(second.json().skipped).toContain('op-1');

    const changes = await app.inject({ method: 'GET', url: '/sync/changes?since=0', headers: auth() });
    expect(changes.statusCode).toBe(200);
    expect(changes.json().changes.length).toBeGreaterThan(0);
    expect(changes.json().latestSeq).toBeGreaterThan(0);
  });
});
