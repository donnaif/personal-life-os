import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSettingsStore, DEFAULT_SETTINGS, MAX_NOTIFIED_IDS, sanitizeSettings } from '../src/settings-store.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-settings-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('settings store', () => {
  it('starts from defaults when the file does not exist', () => {
    const store = createSettingsStore(path.join(tmpDir, 'missing.json'));
    expect(store.read()).toEqual(DEFAULT_SETTINGS);
    expect(store.read().notificationsEnabled).toBe(false);
  });

  it('keeps the user settings when the file has a UTF-8 BOM', () => {
    const file = path.join(tmpDir, 'bom.json');
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ notificationsEnabled: true, minimizeToTray: true })}`);
    expect(createSettingsStore(file).read().notificationsEnabled).toBe(true);
  });

  it('falls back to defaults on corrupt json', () => {
    const file = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(file, '{ this is not json');
    expect(createSettingsStore(file).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists updates atomically and reloads them', () => {
    const file = path.join(tmpDir, 'persist.json');
    const store = createSettingsStore(file);
    store.update({ notificationsEnabled: true, minimizeToTray: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ notificationsEnabled: true, minimizeToTray: true });
    expect(createSettingsStore(file).read().notificationsEnabled).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('drops unknown and malformed values', () => {
    const file = path.join(tmpDir, 'strict.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        notificationsEnabled: 'yes',
        minimizeToTray: 1,
        apiBaseUrl: 'javascript:alert(1)',
        windowBounds: { width: 5, height: 'tall' },
        extra: 'ignored',
        notifiedSessionIds: ['ok', 5, '', 'x'.repeat(200)],
      }),
    );
    const settings = createSettingsStore(file).read();
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.minimizeToTray).toBe(false);
    expect(settings.apiBaseUrl).toBeNull();
    expect(settings.windowBounds).toBeNull();
    expect(settings.notifiedSessionIds).toEqual(['ok']);
  });

  it('accepts a valid api base and window bounds', () => {
    const settings = sanitizeSettings({
      apiBaseUrl: 'http://127.0.0.1:3100/',
      windowBounds: { width: 1280, height: 840, x: -40, y: 20 },
    });
    expect(settings.apiBaseUrl).toBe('http://127.0.0.1:3100');
    expect(settings.windowBounds).toEqual({ width: 1280, height: 840, x: -40, y: 20 });
  });

  it('caps the notified session history', () => {
    const ids = Array.from({ length: MAX_NOTIFIED_IDS + 50 }, (_, i) => `s-${i}`);
    const settings = sanitizeSettings({ notifiedSessionIds: ids });
    expect(settings.notifiedSessionIds).toHaveLength(MAX_NOTIFIED_IDS);
    expect(settings.notifiedSessionIds.at(-1)).toBe(`s-${MAX_NOTIFIED_IDS + 49}`);
  });

  it('does not throw when the profile path is unwritable', () => {
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'file, not directory');
    const store = createSettingsStore(path.join(blocker, 'nested', 'settings.json'));
    expect(() => store.update({ notificationsEnabled: true })).not.toThrow();
    expect(store.read().notificationsEnabled).toBe(true);
  });
});
