import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, clearSession, getRefreshToken, refreshSession, setAccessToken, setRefreshToken, setSessionLostHandler } from '../api/client';
import { authApi } from '../api/endpoints';
import type { AuthUser, TokenResponse } from '../api/types';

type AuthStatus = 'booting' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<AuthUser | null>(null);

  const applyTokens = useCallback((tokens: TokenResponse) => {
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
  }, []);

  // Restore a session on first load.
  useEffect(() => {
    let cancelled = false;
    const clearHandler = setSessionLostHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });

    (async () => {
      if (!getRefreshToken()) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      const ok = await refreshSession();
      if (!ok) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
      clearHandler();
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await authApi.login(email, password);
      applyTokens(tokens);
      const me = await authApi.me();
      setUser(me);
      setStatus('authenticated');
    },
    [applyTokens],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const tokens = await authApi.register(email, password, name);
      applyTokens(tokens);
      const me = await authApi.me();
      setUser(me);
      setStatus('authenticated');
    },
    [applyTokens],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      // A dead token is still a logout; only surface unexpected failures.
      if (err instanceof ApiError && err.isNetwork) {
        // keep going: local session is cleared regardless
      }
    }
    clearSession();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
