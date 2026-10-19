import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE,
  DEFAULT_SERVER_PORT,
  DEV_SERVER_DEFAULT,
  SERVER_PORT_FALLBACKS,
  normalizeApiBase,
  resolveConfig,
} from '../src/config.js';

const distDir = path.resolve('C:/lifeos/apps/desktop/dist');

describe('api base normalization', () => {
  it('falls back to the local default', () => {
    expect(normalizeApiBase(undefined)).toBe(DEFAULT_API_BASE);
    expect(normalizeApiBase('')).toBe(DEFAULT_API_BASE);
    expect(normalizeApiBase('   ')).toBe(DEFAULT_API_BASE);
    expect(normalizeApiBase('not a url')).toBe(DEFAULT_API_BASE);
    expect(normalizeApiBase('ftp://127.0.0.1:3100')).toBe(DEFAULT_API_BASE);
    expect(normalizeApiBase('file:///etc/passwd')).toBe(DEFAULT_API_BASE);
  });

  it('keeps http(s) targets and strips the trailing slash', () => {
    expect(normalizeApiBase('http://127.0.0.1:3100/')).toBe('http://127.0.0.1:3100');
    expect(normalizeApiBase('https://api.example.com')).toBe('https://api.example.com');
    expect(normalizeApiBase('  http://192.168.1.10:3100  ')).toBe('http://192.168.1.10:3100');
  });
});

describe('desktop config resolution', () => {
  it('points at the web build next to the source tree in development', () => {
    const config = resolveConfig({ argv: [], env: {}, distDir });
    expect(config.webRoot).toBe(path.resolve(distDir, '..', '..', 'web', 'dist'));
    expect(config.apiBaseUrl).toBe(DEFAULT_API_BASE);
    expect(config.devServerUrl).toBeUndefined();
    expect(config.smoke).toBe(false);
  });

  it('uses the packaged resources directory when packaged', () => {
    const config = resolveConfig({
      argv: [],
      env: {},
      distDir: 'C:/lifeos/resources/app.asar/dist',
      packaged: true,
      resourcesPath: 'C:/lifeos/resources',
    });
    expect(config.webRoot).toBe(path.join('C:/lifeos/resources', 'web'));
  });

  it('honours cli flags and env overrides', () => {
    const flagged = resolveConfig({
      argv: ['--dev', '--smoke', '--verbose', '--api=http://127.0.0.1:4000'],
      env: {},
      distDir,
    });
    expect(flagged.devServerUrl).toBe(DEV_SERVER_DEFAULT);
    expect(flagged.smoke).toBe(true);
    expect(flagged.verbose).toBe(true);
    expect(flagged.apiBaseUrl).toBe('http://127.0.0.1:4000');

    const fromEnv = resolveConfig({
      argv: [],
      env: { LIFEOS_API_URL: 'http://127.0.0.1:5000', LIFEOS_WEB_ROOT: 'D:/web', LIFEOS_SMOKE: '1' },
      distDir,
    });
    expect(fromEnv.apiBaseUrl).toBe('http://127.0.0.1:5000');
    expect(fromEnv.webRoot).toBe('D:/web');
    expect(fromEnv.smoke).toBe(true);
    expect(fromEnv.devServerUrl).toBeUndefined();
  });

  it('ignores --dev-server unless dev mode is requested', () => {
    const config = resolveConfig({ argv: ['--dev-server=http://127.0.0.1:9999'], env: {}, distDir });
    expect(config.devServerUrl).toBeUndefined();
    const dev = resolveConfig({ argv: ['--dev', '--dev-server=http://127.0.0.1:9999'], env: {}, distDir });
    expect(dev.devServerUrl).toBe('http://127.0.0.1:9999');
  });

  it('serves the UI on a stable loopback port so a session survives relaunch', () => {
    const fallback = resolveConfig({ argv: [], env: {}, distDir });
    expect(fallback.serverPort).toBe(DEFAULT_SERVER_PORT);
    expect(fallback.serverPortFallbacks).toContain(SERVER_PORT_FALLBACKS[0]);

    const flagged = resolveConfig({ argv: ['--port=3199'], env: {}, distDir });
    expect(flagged.serverPort).toBe(3199);

    const fromEnv = resolveConfig({ argv: [], env: { LIFEOS_DESKTOP_PORT: '3200' }, distDir });
    expect(fromEnv.serverPort).toBe(3200);

    for (const bad of ['0', '80', '70000', 'abc']) {
      expect(resolveConfig({ argv: [`--port=${bad}`], env: {}, distDir }).serverPort).toBe(DEFAULT_SERVER_PORT);
    }
  });

  it('accepts an isolated profile directory for verification runs', () => {
    expect(resolveConfig({ argv: [], env: {}, distDir }).profileDir).toBeUndefined();
    expect(resolveConfig({ argv: ['--profile-dir=D:/tmp/p'], env: {}, distDir }).profileDir).toBe('D:/tmp/p');
    expect(resolveConfig({ argv: [], env: { LIFEOS_PROFILE_DIR: 'D:/tmp/q' }, distDir }).profileDir).toBe('D:/tmp/q');
  });
});
