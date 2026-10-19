import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

/**
 * Schema migrations, applied in order via PRAGMA user_version.
 * Each entry is one version. Only append — never edit an applied migration.
 */
const MIGRATIONS: string[] = [
  // ---- v1: core schema ----
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_categories_user ON categories(user_id);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    category_id TEXT,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 3,
    importance INTEGER,
    urgency INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    due_at TEXT,
    planned_start_at TEXT,
    completed_at TEXT,
    window_start TEXT,
    window_end TEXT,
    estimated_duration_min INTEGER,
    actual_duration_min INTEGER,
    session_duration_min INTEGER,
    session_count INTEGER,
    session_interval_min INTEGER,
    interval_anchor TEXT,
    recurrence_json TEXT,
    alert_json TEXT,
    deferral_json TEXT,
    notes TEXT,
    depends_on_json TEXT,
    auto_complete INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
  CREATE INDEX idx_tasks_user_due ON tasks(user_id, due_at);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    status TEXT NOT NULL,
    planned_start_at TEXT NOT NULL,
    planned_end_at TEXT NOT NULL,
    planned_duration_min INTEGER NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    actual_duration_min REAL,
    paused_accumulated_ms INTEGER NOT NULL DEFAULT 0,
    last_paused_at TEXT,
    notes TEXT,
    cancel_reason TEXT,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_sessions_task ON sessions(task_id);
  CREATE INDEX idx_sessions_user_start ON sessions(user_id, planned_start_at);

  CREATE TABLE habits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    weekdays_json TEXT,
    target_count INTEGER NOT NULL DEFAULT 1,
    target_period TEXT NOT NULL DEFAULT 'day',
    recurrence_json TEXT,
    skip_dates_json TEXT,
    rest_dates_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_habits_user ON habits(user_id);

  CREATE TABLE habit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (habit_id, date)
  );
  CREATE INDEX idx_habit_logs_habit ON habit_logs(habit_id, date);

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT,
    platform TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_devices_user ON devices(user_id);

  CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

  /* Append-only change log for offline sync / multi-device. */
  CREATE TABLE change_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    payload_json TEXT,
    device_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_change_log_user ON change_log(user_id, seq);

  /* Idempotency ledger: prevents the same offline operation applying twice. */
  CREATE TABLE sync_ops (
    op_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT,
    applied_at TEXT NOT NULL
  );
  `,
];

export function createDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  let version = row?.user_version ?? 0;
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      version = i + 1;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Run a function inside a transaction; rolls back on error. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
