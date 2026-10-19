import type { Habit, HabitLog, Session, Task, UserSettings } from '@lifeos/core';
import type { Db } from './db.js';
import {
  habitLogToParams,
  habitToParams,
  rowToHabit,
  rowToHabitLog,
  rowToSession,
  rowToTask,
  sessionToParams,
  taskToParams,
} from './mappers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Params = Record<string, unknown>;

function insert(db: Db, table: string, params: Params): void {
  const cols = Object.keys(params);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  db.prepare(sql).run(...cols.map((c) => params[c] as any));
}

function update(db: Db, table: string, id: string, params: Params): void {
  const cols = Object.keys(params).filter((c) => c !== 'id');
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...cols.map((c) => params[c] as any), id);
}

// ---------------------------------------------------------------------------
// Users & settings
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export const usersRepo = {
  create(db: Db, u: UserRow): void {
    insert(db, 'users', { ...u } as Params);
  },
  findByEmail(db: Db, email: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  },
  findById(db: Db, id: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
  count(db: Db): number {
    const r = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return r.c;
  },
};

export const settingsRepo = {
  get(db: Db, userId: string): UserSettings | undefined {
    const r = db.prepare('SELECT json FROM settings WHERE user_id = ?').get(userId) as
      | { json: string }
      | undefined;
    return r ? (JSON.parse(r.json) as UserSettings) : undefined;
  },
  upsert(db: Db, userId: string, settings: UserSettings): void {
    db.prepare(
      `INSERT INTO settings (user_id, json, updated_at, version) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, version = excluded.version`,
    ).run(userId, JSON.stringify(settings), settings.updatedAt, settings.version);
  },
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const tasksRepo = {
  create(db: Db, task: Task): void {
    insert(db, 'tasks', taskToParams(task));
  },
  upsert(db: Db, task: Task): void {
    const p = taskToParams(task);
    const cols = Object.keys(p);
    const sql = `INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`;
    db.prepare(sql).run(...cols.map((c) => p[c] as any));
  },
  get(db: Db, userId: string, id: string): Task | undefined {
    const r = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId) as
      | Record<string, any>
      | undefined;
    return r ? rowToTask(r) : undefined;
  },
  list(db: Db, userId: string, opts: { includeDeleted?: boolean; status?: string } = {}): Task[] {
    let sql = 'SELECT * FROM tasks WHERE user_id = ?';
    const args: any[] = [userId];
    if (!opts.includeDeleted) sql += ' AND deleted_at IS NULL';
    if (opts.status) {
      sql += ' AND status = ?';
      args.push(opts.status);
    }
    sql += ' ORDER BY priority ASC, COALESCE(due_at, \'9999\') ASC, created_at ASC';
    return (db.prepare(sql).all(...args) as Record<string, any>[]).map(rowToTask);
  },
  update(db: Db, task: Task): void {
    update(db, 'tasks', task.id, taskToParams(task));
  },
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionsRepo = {
  upsert(db: Db, s: Session): void {
    const p = sessionToParams(s);
    const cols = Object.keys(p);
    const sql = `INSERT INTO sessions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`;
    db.prepare(sql).run(...cols.map((c) => p[c] as any));
  },
  get(db: Db, userId: string, id: string): Session | undefined {
    const r = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId) as
      | Record<string, any>
      | undefined;
    return r ? rowToSession(r) : undefined;
  },
  listByTask(db: Db, userId: string, taskId: string): Session[] {
    return (
      db
        .prepare('SELECT * FROM sessions WHERE user_id = ? AND task_id = ? ORDER BY idx ASC')
        .all(userId, taskId) as Record<string, any>[]
    ).map(rowToSession);
  },
  listRange(db: Db, userId: string, fromIso: string, toIso: string): Session[] {
    return (
      db
        .prepare(
          'SELECT * FROM sessions WHERE user_id = ? AND planned_start_at >= ? AND planned_start_at < ? ORDER BY planned_start_at ASC',
        )
        .all(userId, fromIso, toIso) as Record<string, any>[]
    ).map(rowToSession);
  },
  listByUser(db: Db, userId: string): Session[] {
    return (
      db
        .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY planned_start_at ASC')
        .all(userId) as Record<string, any>[]
    ).map(rowToSession);
  },
  deleteByTask(db: Db, userId: string, taskId: string): void {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND task_id = ?').run(userId, taskId);
  },
  /** Remove only sessions that were never started — history is never destroyed. */
  deletePlannedByTask(db: Db, userId: string, taskId: string): void {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND task_id = ? AND status = 'planned'").run(userId, taskId);
  },
};

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export const habitsRepo = {
  upsert(db: Db, h: Habit): void {
    const p = habitToParams(h);
    const cols = Object.keys(p);
    const sql = `INSERT INTO habits (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`;
    db.prepare(sql).run(...cols.map((c) => p[c] as any));
  },
  get(db: Db, userId: string, id: string): Habit | undefined {
    const r = db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId) as
      | Record<string, any>
      | undefined;
    return r ? rowToHabit(r) : undefined;
  },
  list(db: Db, userId: string, includeArchived = false): Habit[] {
    const sql = includeArchived
      ? 'SELECT * FROM habits WHERE user_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM habits WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at ASC';
    return (db.prepare(sql).all(userId) as Record<string, any>[]).map(rowToHabit);
  },
  delete(db: Db, userId: string, id: string): void {
    db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(id, userId);
  },
};

export const habitLogsRepo = {
  upsert(db: Db, l: HabitLog): void {
    const p = habitLogToParams(l);
    const cols = Object.keys(p);
    const sql = `INSERT INTO habit_logs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed, count = excluded.count,
        note = excluded.note, updated_at = excluded.updated_at, version = excluded.version`;
    db.prepare(sql).run(...cols.map((c) => p[c] as any));
  },
  listByHabit(db: Db, userId: string, habitId: string): HabitLog[] {
    return (
      db
        .prepare('SELECT * FROM habit_logs WHERE user_id = ? AND habit_id = ? ORDER BY date ASC')
        .all(userId, habitId) as Record<string, any>[]
    ).map(rowToHabitLog);
  },
  listByUser(db: Db, userId: string): HabitLog[] {
    return (
      db
        .prepare('SELECT * FROM habit_logs WHERE user_id = ? ORDER BY date ASC')
        .all(userId) as Record<string, any>[]
    ).map(rowToHabitLog);
  },
};

// ---------------------------------------------------------------------------
// Refresh tokens, devices, sync
// ---------------------------------------------------------------------------

export const refreshTokensRepo = {
  create(db: Db, r: { id: string; userId: string; tokenHash: string; expiresAt: string; createdAt: string }): void {
    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(r.id, r.userId, r.tokenHash, r.expiresAt, r.createdAt);
  },
  findActive(db: Db, tokenHash: string): { id: string; user_id: string; expires_at: string } | undefined {
    return db
      .prepare(
        'SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL',
      )
      .get(tokenHash) as { id: string; user_id: string; expires_at: string } | undefined;
  },
  revoke(db: Db, id: string, at: string): void {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(at, id);
  },
  revokeAllForUser(db: Db, userId: string, at: string): void {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(at, userId);
  },
};

export const devicesRepo = {
  upsert(db: Db, d: { id: string; userId: string; name: string | null; platform: string | null; lastSeenAt: string; createdAt: string }): void {
    db.prepare(
      `INSERT INTO devices (id, user_id, name, platform, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
    ).run(d.id, d.userId, d.name, d.platform, d.lastSeenAt, d.createdAt);
  },
};

export const changeLogRepo = {
  append(db: Db, e: { userId: string; entity: string; entityId: string; op: string; payload?: unknown; deviceId?: string | null; createdAt: string }): number {
    const info = db
      .prepare(
        'INSERT INTO change_log (user_id, entity, entity_id, op, payload_json, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(e.userId, e.entity, e.entityId, e.op, e.payload ? JSON.stringify(e.payload) : null, e.deviceId ?? null, e.createdAt);
    return Number(info.lastInsertRowid);
  },
  listSince(db: Db, userId: string, sinceSeq: number): Array<{ seq: number; entity: string; entity_id: string; op: string; payload_json: string | null; created_at: string }> {
    return db
      .prepare('SELECT seq, entity, entity_id, op, payload_json, created_at FROM change_log WHERE user_id = ? AND seq > ? ORDER BY seq ASC')
      .all(userId, sinceSeq) as Array<{ seq: number; entity: string; entity_id: string; op: string; payload_json: string | null; created_at: string }>;
  },
};

export const syncOpsRepo = {
  /** Returns true if the op was newly recorded, false if it already existed (idempotent). */
  record(db: Db, opId: string, userId: string, deviceId: string | null, appliedAt: string): boolean {
    const existing = db.prepare('SELECT 1 FROM sync_ops WHERE op_id = ?').get(opId);
    if (existing) return false;
    db.prepare('INSERT INTO sync_ops (op_id, user_id, device_id, applied_at) VALUES (?, ?, ?, ?)').run(opId, userId, deviceId, appliedAt);
    return true;
  },
};
