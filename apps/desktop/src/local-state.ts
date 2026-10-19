import fs from 'node:fs';
import path from 'node:path';

export const MAX_KEYS = 64;
export const MAX_VALUE_CHARS = 16_384;
export const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export interface LocalStateStore {
  filePath: string;
  get: (key: string) => string | null;
  set: (key: string, value: string | null) => void;
}

/** Tolerates files written by other tools (notably a UTF-8 BOM from PowerShell). */
export function parseJsonObject(raw: string): unknown {
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(cleaned);
}

function sanitize(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY_PATTERN.test(key)) continue;
    if (typeof value !== 'string' || value.length > MAX_VALUE_CHARS) continue;
    out[key] = value;
    if (Object.keys(out).length >= MAX_KEYS) break;
  }
  return out;
}

/**
 * Small JSON key/value file in the app profile.
 * Used for values that must outlive a renderer origin change (an encrypted
 * refresh token), where localStorage would silently start empty.
 */
export function createLocalStateStore(filePath: string): LocalStateStore {
  let cache: Record<string, string> | null = null;

  const read = (): Record<string, string> => {
    if (cache) return cache;
    try {
      cache = sanitize(parseJsonObject(fs.readFileSync(filePath, 'utf8')));
    } catch {
      cache = {};
    }
    return cache;
  };

  const persist = (state: Record<string, string>): void => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, filePath);
    } catch {
      /* read-only profile: keep the in-memory value, never crash the app */
    }
  };

  return {
    filePath,
    get: (key) => {
      if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return null;
      return read()[key] ?? null;
    },
    set: (key, value) => {
      if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return;
      const state = { ...read() };
      if (value === null || value === undefined) {
        delete state[key];
      } else {
        if (typeof value !== 'string' || value.length > MAX_VALUE_CHARS) return;
        const keys = Object.keys(state);
        if (!(key in state) && keys.length >= MAX_KEYS) {
          const oldest = keys[0];
          if (oldest !== undefined) delete state[oldest];
        }
        state[key] = value;
      }
      cache = state;
      persist(state);
    },
  };
}
