import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  buildAlertPlan,
  cancelSession,
  completeSession,
  dailyTimeSeries,
  habitStreak,
  makeInterval,
  newId,
  pauseSession,
  planSchedule,
  planTask,
  resumeSession,
  startSession,
  summarizeSessions,
  summarizeTasks,
  timeByCategory,
  type Habit,
  type HabitLog,
  type ScheduleConflict,
  type Session,
  type Task,
  type UserSettings,
} from '@lifeos/core';
import { hashPassword, hashToken, newOpaqueToken, verifyPassword } from './auth.js';
import type { Env } from './env.js';
import {
  changeLogRepo,
  devicesRepo,
  habitLogsRepo,
  habitsRepo,
  refreshTokensRepo,
  sessionsRepo,
  settingsRepo,
  syncOpsRepo,
  tasksRepo,
  usersRepo,
} from './repos.js';

const nowIso = (): string => new Date().toISOString();

function defaultSettings(userId: string): UserSettings {
  const t = nowIso();
  return {
    userId,
    timezone: 'UTC',
    locale: 'ar',
    theme: 'system',
    availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday: weekday as UserSettings['availability'][number]['weekday'],
      windows: [{ startMin: 6 * 60, endMin: 23 * 60 }],
    })),
    quietHours: [{ startMin: 23 * 60, endMin: 6 * 60 }],
    defaultSessionDurationMin: 30,
    defaultBreakMin: 5,
    allowOverlap: false,
    minLeadTimeMin: 0,
    updatedAt: t,
    version: 1,
  };
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'interval']),
  interval: z.number().int().positive().optional(),
  intervalUnit: z.enum(['minute', 'hour', 'day', 'week', 'month']).optional(),
  byWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  byMonthDay: z.array(z.number().int().min(1).max(31)).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  count: z.number().int().positive().optional(),
  skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

const alertSchema = z.object({
  enabled: z.boolean(),
  offsetBeforeMin: z.number().int().min(0).max(1440).optional(),
  atStart: z.boolean(),
  atEnd: z.boolean(),
  repeatCount: z.number().int().min(0).max(20).optional(),
  repeatIntervalMin: z.number().int().min(1).max(1440).optional(),
  sound: z.string().max(100).nullable().optional(),
  soundEnabled: z.boolean(),
  snoozeMinutes: z.number().int().min(0).max(1440).optional(),
  channels: z.array(z.enum(['local', 'push'])).optional(),
});

const taskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  categoryId: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  urgency: z.number().int().min(1).max(5).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueAt: z.string().datetime().optional(),
  plannedStartAt: z.string().datetime().optional(),
  windowStart: hhmm.optional(),
  windowEnd: hhmm.optional(),
  estimatedDurationMin: z.number().int().positive().max(10_080).optional(),
  sessionDurationMin: z.number().int().positive().max(1440).optional(),
  sessionCount: z.number().int().positive().max(200).optional(),
  sessionIntervalMin: z.number().int().min(0).max(10_080).optional(),
  intervalAnchor: z.enum(['start', 'end']).optional(),
  recurrence: recurrenceSchema.optional(),
  alert: alertSchema.optional(),
  notes: z.string().max(10_000).optional(),
  dependsOn: z.array(z.string()).max(50).optional(),
  autoComplete: z.boolean().optional(),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(TASK_STATUSES).optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

const settingsSchema = z.object({
  timezone: z.string().min(1).max(64),
  locale: z.enum(['ar', 'en']),
  theme: z.enum(['light', 'dark', 'system']),
  availability: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      windows: z.array(z.object({ startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(0).max(1440) })),
    }),
  ),
  quietHours: z.array(z.object({ startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(0).max(1440) })),
  defaultSessionDurationMin: z.number().int().positive().max(1440),
  defaultBreakMin: z.number().int().min(0).max(1440),
  allowOverlap: z.boolean(),
  minLeadTimeMin: z.number().int().min(0).max(1440),
});

const habitCreateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  targetCount: z.number().int().positive().max(100).optional(),
  targetPeriod: z.enum(['day', 'week', 'month']).optional(),
  recurrence: recurrenceSchema.optional(),
  skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  restDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

const habitLogSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.boolean().optional(),
  count: z.number().int().min(0).max(1000).optional(),
  note: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const db = app.db;

  const requireAuth = async (req: FastifyRequest, reply: import('fastify').FastifyReply): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };
  const uid = (req: FastifyRequest): string => req.user.sub;

  const logChange = (
    userId: string,
    entity: string,
    entityId: string,
    op: string,
    payload?: unknown,
    deviceId?: string | null,
  ): void => {
    changeLogRepo.append(db, { userId, entity, entityId, op, payload, deviceId, createdAt: nowIso() });
  };

  // ---------------- health ----------------
  app.get('/health', async () => ({ status: 'ok', time: nowIso() }));

  // ---------------- auth ----------------
  app.post('/auth/register', async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(8).max(200), name: z.string().max(200).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input', issues: body.error.issues });

    // Personal instance: only allow the very first user to self-register.
    if (usersRepo.count(db) > 0) return reply.code(403).send({ error: 'registration_closed' });

    const id = newId();
    const t = nowIso();
    usersRepo.create(db, {
      id,
      email: body.data.email.toLowerCase(),
      password_hash: await hashPassword(body.data.password),
      name: body.data.name ?? null,
      created_at: t,
      updated_at: t,
      version: 1,
    });
    settingsRepo.upsert(db, id, defaultSettings(id));
    return reply.code(201).send(await issueTokens(app, id, body.data.email.toLowerCase(), null, null));
  });

  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const user = usersRepo.findByEmail(db, body.data.email.toLowerCase());
    if (!user || !(await verifyPassword(body.data.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return reply.send(await issueTokens(app, user.id, user.email, null, null));
  });

  app.post('/auth/refresh', async (req, reply) => {
    const body = z.object({ refreshToken: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const row = refreshTokensRepo.findActive(db, hashToken(body.data.refreshToken));
    if (!row || Date.parse(row.expires_at) < Date.now()) return reply.code(401).send({ error: 'invalid_refresh' });
    refreshTokensRepo.revoke(db, row.id, nowIso());
    const user = usersRepo.findById(db, row.user_id);
    if (!user) return reply.code(401).send({ error: 'invalid_refresh' });
    return reply.send(await issueTokens(app, user.id, user.email, null, null));
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    refreshTokensRepo.revokeAllForUser(db, uid(req), nowIso());
    return reply.send({ ok: true });
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = usersRepo.findById(db, uid(req));
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ id: user.id, email: user.email, name: user.name });
  });

  // ---------------- settings ----------------
  app.get('/settings', { preHandler: requireAuth }, async (req, reply) => {
    return reply.send(settingsRepo.get(db, uid(req)) ?? defaultSettings(uid(req)));
  });

  app.put('/settings', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    const userId = uid(req);
    const current = settingsRepo.get(db, userId);
    const next: UserSettings = {
      userId,
      ...(parsed.data as unknown as Omit<UserSettings, 'userId' | 'updatedAt' | 'version'>),
      updatedAt: nowIso(),
      version: (current?.version ?? 0) + 1,
    };
    settingsRepo.upsert(db, userId, next);
    return reply.send(next);
  });

  // ---------------- tasks ----------------
  app.get('/tasks', { preHandler: requireAuth }, async (req) => {
    const q = req.query as { includeDeleted?: string; status?: string };
    return tasksRepo.list(db, uid(req), {
      includeDeleted: q.includeDeleted === 'true',
      ...(q.status ? { status: q.status } : {}),
    });
  });

  app.post('/tasks', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    const userId = uid(req);
    const t = nowIso();
    const task: Task = {
      id: newId(),
      userId,
      title: parsed.data.title,
      createdAt: t,
      updatedAt: t,
      version: 1,
      status: parsed.data.status ?? 'not_started',
      priority: (parsed.data.priority ?? 3) as Task['priority'],
      ...(parsed.data as unknown as Partial<Task>),
    };
    tasksRepo.create(db, task);
    logChange(userId, 'task', task.id, 'create', task);
    return reply.code(201).send(task);
  });

  app.get('/tasks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const task = tasksRepo.get(db, uid(req), (req.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'not_found' });
    return reply.send(task);
  });

  app.patch('/tasks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const id = (req.params as { id: string }).id;
    const existing = tasksRepo.get(db, userId, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });

    const patch = parsed.data as unknown as Partial<Task>;
    const next: Task = { ...existing, ...patch, updatedAt: nowIso(), version: existing.version + 1 };
    if (patch.status === 'completed' && existing.status !== 'completed') next.completedAt = patch.completedAt ?? nowIso();
    if (patch.status && patch.status !== 'completed') delete next.completedAt;
    tasksRepo.update(db, next);
    logChange(userId, 'task', id, 'update', next);
    return reply.send(next);
  });

  app.delete('/tasks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const id = (req.params as { id: string }).id;
    const existing = tasksRepo.get(db, userId, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const next: Task = { ...existing, deletedAt: nowIso(), updatedAt: nowIso(), version: existing.version + 1 };
    tasksRepo.update(db, next);
    logChange(userId, 'task', id, 'delete', next);
    return reply.send({ ok: true });
  });

  // ---------------- sessions ----------------
  app.get('/tasks/:id/sessions', { preHandler: requireAuth }, async (req) => {
    return sessionsRepo.listByTask(db, uid(req), (req.params as { id: string }).id);
  });

  /** Plan (and persist) sessions for a single task. */
  app.post('/tasks/:id/plan', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const id = (req.params as { id: string }).id;
    const task = tasksRepo.get(db, userId, id);
    if (!task) return reply.code(404).send({ error: 'not_found' });
    const settings = settingsRepo.get(db, userId) ?? defaultSettings(userId);
    const result = planTask(task, {
      timezone: settings.timezone,
      availability: settings.availability,
      quietHours: settings.quietHours,
      // Every other task keeps its already-placed sessions: this task must not
      // be re-booked on top of them.
      busy: busyIntervals(db, userId, new Set([id])),
      allowOverlap: settings.allowOverlap,
      defaultSessionDurationMin: settings.defaultSessionDurationMin,
      defaultBreakMin: settings.defaultBreakMin,
      minLeadTimeMin: settings.minLeadTimeMin,
      nowMs: Date.now(),
      horizonDays: 14,
    });
    const persisted = persistSessions(db, userId, id, result.sessions);
    const alerts = buildAlertPlan(task, result.sessions);
    logChange(userId, 'session', id, 'plan', persisted);
    return reply.send({ sessions: persisted, alerts, conflicts: result.conflicts });
  });

  app.get('/sessions', { preHandler: requireAuth }, async (req) => {
    const q = req.query as { from?: string; to?: string };
    if (q.from && q.to) return sessionsRepo.listRange(db, uid(req), q.from, q.to);
    return sessionsRepo.listByUser(db, uid(req));
  });

  for (const action of ['start', 'pause', 'resume', 'complete', 'cancel'] as const) {
    app.post(`/sessions/:id/${action}`, { preHandler: requireAuth }, async (req, reply) => {
      const userId = uid(req);
      const id = (req.params as { id: string }).id;
      const session = sessionsRepo.get(db, userId, id);
      if (!session) return reply.code(404).send({ error: 'not_found' });
      const now = Date.now();
      try {
        const next = applySessionAction(action, session, now, req.body);
        sessionsRepo.upsert(db, next);
        logChange(userId, 'session', id, action, next);
        if (action === 'complete') maybeAutoCompleteTask(db, userId, next.taskId);
        return reply.send(next);
      } catch (err) {
        return reply.code(409).send({ error: 'invalid_transition', message: (err as Error).message });
      }
    });
  }

  // ---------------- scheduling (whole plan) ----------------
  app.post('/schedule/plan', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const settings = settingsRepo.get(db, userId) ?? defaultSettings(userId);
    const allTasks = tasksRepo.list(db, userId);
    // Only open tasks are (re)planned; terminal tasks keep their history, and
    // that history counts as busy time so it is never booked over.
    const plannedIds = new Set(
      allTasks.filter((t) => !TERMINAL_TASK_STATUSES.includes(t.status)).map((t) => t.id),
    );
    const result = planSchedule(allTasks, {
      timezone: settings.timezone,
      availability: settings.availability,
      quietHours: settings.quietHours,
      busy: busyIntervals(db, userId, plannedIds),
      allowOverlap: settings.allowOverlap,
      defaultSessionDurationMin: settings.defaultSessionDurationMin,
      defaultBreakMin: settings.defaultBreakMin,
      minLeadTimeMin: settings.minLeadTimeMin,
      nowMs: Date.now(),
      horizonDays: 14,
    });

    const body = z.object({ persist: z.boolean().optional() }).safeParse(req.body ?? {});
    if (body.success && body.data.persist) {
      // Never touch tasks outside the planned scope (completed/cancelled ones).
      for (const r of result.results) {
        if (plannedIds.has(r.taskId)) persistSessions(db, userId, r.taskId, r.sessions);
      }
    }
    const conflicts: ScheduleConflict[] = result.conflicts;
    return reply.send({
      results: result.results.map((r) => ({
        taskId: r.taskId,
        sessions: r.sessions.map((s) => ({
          taskId: s.taskId,
          index: s.index,
          startAt: new Date(s.startMs).toISOString(),
          endAt: new Date(s.endMs).toISOString(),
          durationMin: s.durationMin,
        })),
      })),
      conflicts,
    });
  });

  // ---------------- habits ----------------
  app.get('/habits', { preHandler: requireAuth }, async (req) => {
    const q = req.query as { includeArchived?: string };
    return habitsRepo.list(db, uid(req), q.includeArchived === 'true');
  });

  app.post('/habits', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = habitCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    const userId = uid(req);
    const t = nowIso();
    const habit: Habit = {
      id: newId(),
      userId,
      title: parsed.data.title,
      targetCount: parsed.data.targetCount ?? 1,
      targetPeriod: parsed.data.targetPeriod ?? 'day',
      createdAt: t,
      updatedAt: t,
      version: 1,
      ...(parsed.data as unknown as Partial<Habit>),
    };
    habitsRepo.upsert(db, habit);
    logChange(userId, 'habit', habit.id, 'create', habit);
    return reply.code(201).send(habit);
  });

  app.patch('/habits/:id', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const id = (req.params as { id: string }).id;
    const existing = habitsRepo.get(db, userId, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const parsed = habitCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    const next: Habit = {
      ...existing,
      ...(parsed.data as unknown as Partial<Habit>),
      updatedAt: nowIso(),
      version: existing.version + 1,
    };
    habitsRepo.upsert(db, next);
    logChange(userId, 'habit', id, 'update', next);
    return reply.send(next);
  });

  app.delete('/habits/:id', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const id = (req.params as { id: string }).id;
    const existing = habitsRepo.get(db, userId, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const next: Habit = { ...existing, archivedAt: nowIso(), updatedAt: nowIso(), version: existing.version + 1 };
    habitsRepo.upsert(db, next);
    logChange(userId, 'habit', id, 'archive', next);
    return reply.send({ ok: true });
  });

  app.post('/habits/:id/log', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const habitId = (req.params as { id: string }).id;
    const habit = habitsRepo.get(db, userId, habitId);
    if (!habit) return reply.code(404).send({ error: 'not_found' });
    const parsed = habitLogSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    const log: HabitLog = {
      id: newId(),
      userId,
      habitId,
      date: parsed.data.date,
      completed: parsed.data.completed ?? true,
      count: parsed.data.count ?? habit.targetCount,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
      updatedAt: nowIso(),
      version: 1,
    };
    habitLogsRepo.upsert(db, log);
    logChange(userId, 'habit_log', habitId, 'log', log);
    return reply.send(log);
  });

  app.get('/habits/:id/streak', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const habitId = (req.params as { id: string }).id;
    const habit = habitsRepo.get(db, userId, habitId);
    if (!habit) return reply.code(404).send({ error: 'not_found' });
    const today = new Date().toISOString().slice(0, 10);
    const logs = habitLogsRepo.listByHabit(db, userId, habitId);
    return reply.send(habitStreak(habit, logs, today));
  });

  // ---------------- reports ----------------
  app.get('/reports/summary', { preHandler: requireAuth }, async (req) => {
    const userId = uid(req);
    const settings = settingsRepo.get(db, userId) ?? defaultSettings(userId);
    const q = req.query as { from?: string; to?: string };
    let sessions = sessionsRepo.listByUser(db, userId);
    if (q.from && q.to) {
      sessions = sessions.filter((s) => s.plannedStartAt >= q.from! && s.plannedStartAt < q.to!);
    }
    const tasks = tasksRepo.list(db, userId);
    return {
      tasks: summarizeTasks(tasks, Date.now()),
      sessions: summarizeSessions(sessions),
      byCategory: timeByCategory(sessions, tasks),
      daily: dailyTimeSeries(sessions, settings.timezone),
    };
  });

  // ---------------- sync (offline change log) ----------------
  app.get('/sync/changes', { preHandler: requireAuth }, async (req) => {
    const q = req.query as { since?: string };
    const since = Number(q.since ?? 0) || 0;
    const changes = changeLogRepo.listSince(db, uid(req), since);
    const latest = changes.length > 0 ? changes[changes.length - 1]!.seq : since;
    return { changes, latestSeq: latest };
  });

  app.post('/sync/push', { preHandler: requireAuth }, async (req, reply) => {
    const userId = uid(req);
    const parsed = z
      .object({
        deviceId: z.string().max(200).optional(),
        ops: z.array(
          z.object({
            opId: z.string().min(1).max(200),
            entity: z.enum(['task', 'session', 'habit', 'habit_log']),
            op: z.enum(['create', 'update', 'delete', 'log']),
            payload: z.unknown(),
          }),
        ),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });

    const applied: string[] = [];
    const skipped: string[] = [];
    for (const op of parsed.data.ops) {
      const fresh = syncOpsRepo.record(db, op.opId, userId, parsed.data.deviceId ?? null, nowIso());
      if (!fresh) {
        skipped.push(op.opId);
        continue;
      }
      applied.push(op.opId);
      logChange(userId, op.entity, 'batch', op.op, op.payload, parsed.data.deviceId ?? null);
    }
    if (parsed.data.deviceId) {
      devicesRepo.upsert(db, {
        id: parsed.data.deviceId,
        userId,
        name: null,
        platform: null,
        lastSeenAt: nowIso(),
        createdAt: nowIso(),
      });
    }
    return reply.send({ applied, skipped, appliedCount: applied.length });
  });

  void env;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function issueTokens(
  app: FastifyInstance,
  userId: string,
  email: string,
  deviceName: string | null,
  platform: string | null,
) {
  const env = app.env;
  const accessToken = app.jwt.sign({ sub: userId, email }, { expiresIn: env.ACCESS_TOKEN_TTL });
  const refreshToken = newOpaqueToken();
  refreshTokensRepo.create(app.db, {
    id: newId(),
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000).toISOString(),
    createdAt: nowIso(),
  });
  void deviceName;
  void platform;
  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
    tokenType: 'Bearer',
  };
}

/**
 * Intervals already occupied by stored sessions, used as scheduler `busy` input
 * so a re-plan never books on top of an existing session.
 * Only unstarted (`planned`) sessions of `replacedTaskIds` are skipped, because
 * only those get replaced; every other session — including history of the very
 * same task — is immovable and must be avoided.
 * Cancelled sessions free their slot again.
 */
function busyIntervals(
  db: import('./db.js').Db,
  userId: string,
  replacedTaskIds: ReadonlySet<string>,
): import('@lifeos/core').TimeInterval[] {
  return sessionsRepo
    .listByUser(db, userId)
    .filter((s) => s.status !== 'cancelled' && !(s.status === 'planned' && replacedTaskIds.has(s.taskId)))
    .map((s) => makeInterval(Date.parse(s.plannedStartAt), Date.parse(s.plannedEndAt)));
}

function persistSessions(
  db: import('./db.js').Db,
  userId: string,
  taskId: string,
  planned: Array<{ index: number; startMs: number; endMs: number; durationMin: number }>,
): Session[] {
  // Replace pending sessions only: started, completed or cancelled ones are history.
  sessionsRepo.deletePlannedByTask(db, userId, taskId);
  const t = nowIso();
  const sessions: Session[] = planned.map((p) => ({
    id: newId(),
    userId,
    taskId,
    index: p.index,
    status: 'planned',
    plannedStartAt: new Date(p.startMs).toISOString(),
    plannedEndAt: new Date(p.endMs).toISOString(),
    plannedDurationMin: p.durationMin,
    pausedAccumulatedMs: 0,
    updatedAt: t,
    version: 1,
  }));
  for (const s of sessions) sessionsRepo.upsert(db, s);
  return sessions;
}

function applySessionAction(
  action: 'start' | 'pause' | 'resume' | 'complete' | 'cancel',
  session: Session,
  now: number,
  body: unknown,
): Session {
  switch (action) {
    case 'start':
      return startSession(session, now);
    case 'pause':
      return pauseSession(session, now);
    case 'resume':
      return resumeSession(session, now);
    case 'complete':
      return completeSession(session, now);
    case 'cancel': {
      const reason =
        body && typeof body === 'object' && 'reason' in body
          ? String((body as { reason?: unknown }).reason ?? '')
          : undefined;
      return cancelSession(session, now, reason || undefined);
    }
  }
}

function maybeAutoCompleteTask(db: import('./db.js').Db, userId: string, taskId: string): void {
  const task = tasksRepo.get(db, userId, taskId);
  if (!task || !task.autoComplete) return;
  const sessions = sessionsRepo.listByTask(db, userId, taskId);
  if (sessions.length > 0 && sessions.every((s) => s.status === 'completed')) {
    tasksRepo.update(db, {
      ...task,
      status: 'completed',
      completedAt: nowIso(),
      updatedAt: nowIso(),
      version: task.version + 1,
    });
  }
}
