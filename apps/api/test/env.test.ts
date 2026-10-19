import { describe, expect, it } from 'vitest';
import { DEV_FALLBACK_SECRET, loadEnv, resolveDbPath } from '../src/env.js';

const base = { NODE_ENV: 'development' as const };

describe('api environment', () => {
  it('applies safe development defaults', () => {
    const env = loadEnv({ ...base });
    expect(env.PORT).toBe(3100);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.DATABASE_URL).toBe('file:./data/lifeos.sqlite');
    expect(env.JWT_SECRET).toBe(DEV_FALLBACK_SECRET);
  });

  it('rejects the shipped default secret in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/development default/i);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: DEV_FALLBACK_SECRET })).toThrow(
      /development default/i,
    );
  });

  it('rejects a short secret in production but accepts a long one', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(31) })).toThrow(/at least 32/i);
    const env = loadEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'b'.repeat(32) });
    expect(env.JWT_SECRET).toBe('b'.repeat(32));
  });

  it('still allows the default secret outside production', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      expect(loadEnv({ ...base, NODE_ENV }).JWT_SECRET).toBe(DEV_FALLBACK_SECRET);
    }
  });

  it('reports invalid values instead of guessing', () => {
    expect(() => loadEnv({ ...base, PORT: 'not-a-port' })).toThrow(/Invalid environment/);
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/Invalid environment/);
  });

  it('resolves sqlite paths from the database url', () => {
    expect(resolveDbPath('file:./data/lifeos.sqlite')).toBe('./data/lifeos.sqlite');
    expect(resolveDbPath('file::memory:')).toBe(':memory:');
    expect(resolveDbPath('/abs/path.sqlite')).toBe('/abs/path.sqlite');
  });
});
