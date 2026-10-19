/**
 * Refresh-token persistence with an optional OS-level encryption bridge.
 *
 * Browser: plain localStorage (personal single-user app; the value is a rotating
 * refresh token that is useless without the local API).
 * Desktop shell: the token is encrypted by the Electron main process (Windows
 * DPAPI via safeStorage) before it touches localStorage, so the on-disk copy is
 * never usable on its own. If encryption is unavailable the store degrades to
 * plaintext rather than blocking sign-in, and `isEncrypted()` reports which mode is live.
 */

export const ENCRYPTED_PREFIX = 'enc:';
export const REFRESH_TOKEN_KEY = 'lifeos.refreshToken';

export interface TokenCryptoBridge {
  encrypt: (plain: string) => string | null;
  decrypt: (cipher: string) => string | null;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface TokenStore {
  read: () => string | null;
  write: (token: string | null) => void;
  isEncrypted: () => boolean;
}

export interface CreateTokenStoreOptions {
  storage: StorageLike | null;
  bridge?: TokenCryptoBridge | null;
  key?: string;
}

export function createTokenStore(opts: CreateTokenStoreOptions): TokenStore {
  const key = opts.key ?? REFRESH_TOKEN_KEY;
  const storage = opts.storage;
  const bridge = opts.bridge ?? null;

  const rawRead = (): string | null => {
    try {
      const value = storage?.getItem(key) ?? null;
      return value && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  };

  const read = (): string | null => {
    const raw = rawRead();
    if (!raw) return null;
    if (!raw.startsWith(ENCRYPTED_PREFIX)) return raw;
    const payload = raw.slice(ENCRYPTED_PREFIX.length);
    if (!bridge) return null;
    try {
      const plain = bridge.decrypt(payload);
      return plain && plain.length > 0 ? plain : null;
    } catch {
      return null;
    }
  };

  const write = (token: string | null): void => {
    try {
      if (!token) {
        storage?.removeItem(key);
        return;
      }
      if (storage && bridge) {
        const encrypted = bridge.encrypt(token);
        if (encrypted && encrypted.length > 0) {
          storage.setItem(key, `${ENCRYPTED_PREFIX}${encrypted}`);
          return;
        }
      }
      storage?.setItem(key, token);
    } catch {
      /* storage unavailable (private mode) — session simply won't persist */
    }
  };

  const isEncrypted = (): boolean => rawRead()?.startsWith(ENCRYPTED_PREFIX) === true;

  return { read, write, isEncrypted };
}

export function safeLocalStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = '__lifeos_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
