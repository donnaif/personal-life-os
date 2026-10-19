import { describe, expect, it } from 'vitest';
import { createTokenStore, ENCRYPTED_PREFIX, REFRESH_TOKEN_KEY, type StorageLike } from '../src/api/tokenStore';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

/** Stand-in for the desktop bridge: reversible, obviously-not-plaintext payloads. */
const bridge = {
  encrypt: (plain: string) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (cipher: string) => {
    try {
      return Buffer.from(cipher, 'base64').toString('utf8');
    } catch {
      return null;
    }
  },
};

describe('token store (browser)', () => {
  it('round-trips the refresh token in plain storage', () => {
    const storage = memoryStorage();
    const store = createTokenStore({ storage });
    store.write('refresh-1');
    expect(storage.dump()[REFRESH_TOKEN_KEY]).toBe('refresh-1');
    expect(store.read()).toBe('refresh-1');
    expect(store.isEncrypted()).toBe(false);
  });

  it('clears the token on logout', () => {
    const storage = memoryStorage({ [REFRESH_TOKEN_KEY]: 'refresh-1' });
    createTokenStore({ storage }).write(null);
    expect(storage.dump()[REFRESH_TOKEN_KEY]).toBeUndefined();
  });

  it('treats an encrypted value as unusable without a bridge', () => {
    const storage = memoryStorage({ [REFRESH_TOKEN_KEY]: `${ENCRYPTED_PREFIX}AAAA` });
    const store = createTokenStore({ storage });
    expect(store.read()).toBeNull();
    expect(store.isEncrypted()).toBe(true);
  });
});

describe('token store (desktop bridge)', () => {
  it('never stores the refresh token in clear text', () => {
    const storage = memoryStorage();
    const store = createTokenStore({ storage, bridge });
    store.write('refresh-secret');
    const raw = storage.dump()[REFRESH_TOKEN_KEY]!;
    expect(raw.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(raw).not.toContain('refresh-secret');
    expect(store.read()).toBe('refresh-secret');
    expect(store.isEncrypted()).toBe(true);
  });

  it('survives a reload (decrypt path) and a rotated token', () => {
    const storage = memoryStorage();
    createTokenStore({ storage, bridge }).write('refresh-1');
    const reloaded = createTokenStore({ storage, bridge });
    expect(reloaded.read()).toBe('refresh-1');
    reloaded.write('refresh-2');
    expect(createTokenStore({ storage, bridge }).read()).toBe('refresh-2');
  });

  it('degrades to plaintext when the OS refuses to encrypt', () => {
    const storage = memoryStorage();
    const store = createTokenStore({ storage, bridge: { encrypt: () => null, decrypt: () => null } });
    store.write('refresh-1');
    expect(storage.dump()[REFRESH_TOKEN_KEY]).toBe('refresh-1');
    expect(store.read()).toBe('refresh-1');
  });

  it('returns null when decryption fails instead of using the ciphertext', () => {
    const storage = memoryStorage({ [REFRESH_TOKEN_KEY]: `${ENCRYPTED_PREFIX}not-real` });
    const store = createTokenStore({
      storage,
      bridge: { encrypt: (v) => v, decrypt: () => null },
    });
    expect(store.read()).toBeNull();
  });

  it('reads a legacy plaintext token once and re-encrypts it', () => {
    const storage = memoryStorage({ [REFRESH_TOKEN_KEY]: 'legacy-token' });
    const store = createTokenStore({ storage, bridge });
    expect(store.read()).toBe('legacy-token');
    store.write(store.read());
    expect(storage.dump()[REFRESH_TOKEN_KEY]!.startsWith(ENCRYPTED_PREFIX)).toBe(true);
  });

  it('keeps working when storage is unavailable', () => {
    const store = createTokenStore({ storage: null, bridge });
    expect(() => store.write('refresh-1')).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('ignores throw-on-access storage', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createTokenStore({ storage: hostile, bridge });
    expect(() => store.write('refresh-1')).not.toThrow();
    expect(store.read()).toBeNull();
  });
});
