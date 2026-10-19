import fs from 'node:fs';
import path from 'node:path';
import { parseJsonObject } from './local-state.js';

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface DesktopSettings {
  /** Native notifications are opt-in; nothing is shown until the user enables it. */
  notificationsEnabled: boolean;
  /** Close button hides to tray instead of quitting. */
  minimizeToTray: boolean;
  /** Per-user API override; null means "use the configured default". */
  apiBaseUrl: string | null;
  windowBounds: WindowBounds | null;
  /** Session ids already notified, so a restart cannot re-notify the same session. */
  notifiedSessionIds: string[];
}

export const MAX_NOTIFIED_IDS = 200;

export const DEFAULT_SETTINGS: DesktopSettings = {
  notificationsEnabled: false,
  minimizeToTray: false,
  apiBaseUrl: null,
  windowBounds: null,
  notifiedSessionIds: [],
};

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const width = clampInt(source.width, 720, 10_000);
  const height = clampInt(source.height, 480, 10_000);
  if (width === undefined || height === undefined) return null;
  const bounds: WindowBounds = { width, height };
  const x = clampInt(source.x, -32_000, 32_000);
  const y = clampInt(source.y, -32_000, 32_000);
  if (x !== undefined) bounds.x = x;
  if (y !== undefined) bounds.y = y;
  return bounds;
}

function sanitizeApiBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function sanitizeSettings(raw: unknown): DesktopSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const source = raw as Record<string, unknown>;
  const ids = Array.isArray(source.notifiedSessionIds)
    ? source.notifiedSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
    : [];
  return {
    notificationsEnabled: source.notificationsEnabled === true,
    minimizeToTray: source.minimizeToTray === true,
    apiBaseUrl: sanitizeApiBase(source.apiBaseUrl),
    windowBounds: sanitizeBounds(source.windowBounds),
    notifiedSessionIds: ids.slice(-MAX_NOTIFIED_IDS),
  };
}

export interface SettingsStore {
  filePath: string;
  read: () => DesktopSettings;
  update: (patch: Partial<DesktopSettings>) => DesktopSettings;
}

export function createSettingsStore(filePath: string): SettingsStore {
  let cached: DesktopSettings | null = null;

  const read = (): DesktopSettings => {
    if (cached) return cached;
    try {
      cached = sanitizeSettings(parseJsonObject(fs.readFileSync(filePath, 'utf8')));
    } catch {
      cached = { ...DEFAULT_SETTINGS };
    }
    return cached;
  };

  const persist = (settings: DesktopSettings): void => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, filePath);
    } catch {
      /* unwritable profile: keep the in-memory value, do not crash the app */
    }
  };

  return {
    filePath,
    read,
    update: (patch) => {
      const next = sanitizeSettings({ ...read(), ...patch });
      cached = next;
      persist(next);
      return next;
    },
  };
}
