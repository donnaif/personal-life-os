import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalStateStore, MAX_VALUE_CHARS } from '../src/local-state.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-state-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('local state store', () => {
  it('round-trips a value and survives a reload', () => {
    const file = path.join(tmpDir, 'roundtrip.json');
    const store = createLocalStateStore(file);
    expect(store.get('lifeos.refreshToken')).toBeNull();
    store.set('lifeos.refreshToken', 'enc:abc');
    expect(store.get('lifeos.refreshToken')).toBe('enc:abc');
    expect(createLocalStateStore(file).get('lifeos.refreshToken')).toBe('enc:abc');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('deletes a value on null', () => {
    const file = path.join(tmpDir, 'delete.json');
    const store = createLocalStateStore(file);
    store.set('a', '1');
    store.set('a', null);
    expect(store.get('a')).toBeNull();
  });

  it('refuses malformed keys and oversized values', () => {
    const file = path.join(tmpDir, 'guard.json');
    const store = createLocalStateStore(file);
    store.set('../escape', 'x');
    store.set('bad key', 'x');
    store.set('ok', 'x'.repeat(MAX_VALUE_CHARS + 1));
    expect(store.get('../escape')).toBeNull();
    expect(store.get('bad key')).toBeNull();
    expect(store.get('ok')).toBeNull();
    expect(store.get('')).toBeNull();
  });

  it('drops junk from a corrupt or hostile file', () => {
    const file = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(file, '{ not json');
    expect(createLocalStateStore(file).get('a')).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ 'bad key': 'x', good: 'y', num: 5, huge: 'z'.repeat(MAX_VALUE_CHARS + 1) }));
    const store = createLocalStateStore(file);
    expect(store.get('good')).toBe('y');
    expect(store.get('num')).toBeNull();
    expect(store.get('huge')).toBeNull();
    expect(createLocalStateStore(file).get('bad key')).toBeNull();
  });

  it('tolerates a UTF-8 BOM written by another tool', () => {
    const file = path.join(tmpDir, 'bom.json');
    fs.writeFileSync(file, `\uFEFF${JSON.stringify({ 'lifeos.refreshToken': 'enc:x' })}`);
    expect(createLocalStateStore(file).get('lifeos.refreshToken')).toBe('enc:x');
  });

  it('does not throw when the profile is unwritable', () => {
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'file');
    const store = createLocalStateStore(path.join(blocker, 'nested', 'state.json'));
    expect(() => store.set('a', '1')).not.toThrow();
    expect(store.get('a')).toBe('1');
  });
});
