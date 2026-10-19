/**
 * Thin fetch client with real token handling.
 * - Access token kept in memory only.
 * - Refresh token persisted (personal single-user app), rotated on every use.
 * - On 401 the request is retried exactly once after a refresh.
 * - Network/transport failures surface as ApiError with status 0.
 * - In the desktop shell the persisted token is encrypted by the OS (see tokenStore.ts).
 */

import { getDesktopBridge } from '../desktop-bridge';
import { createTokenStore, safeLocalStorage } from './tokenStore';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

const desktop = getDesktopBridge();

const tokenStore = createTokenStore({
  // Desktop: profile storage + OS encryption. Browser: plain localStorage.
  storage: desktop?.secureStorage ?? safeLocalStorage(),
  bridge: desktop?.tokenCrypto ?? null,
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: unknown;

  constructor(status: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  return tokenStore.read();
}

export function setRefreshToken(token: string | null): void {
  tokenStore.write(token);
}

export function clearSession(): void {
  accessToken = null;
  setRefreshToken(null);
}

/**
 * Called when refresh fails: the UI must drop to the login screen.
 * Returns an unsubscribe function so a stale caller cannot clear a newer handler
 * (e.g. React StrictMode mounting the provider twice).
 */
export function setSessionLostHandler(fn: (() => void) | null): () => void {
  onSessionLost = fn;
  return () => {
    if (onSessionLost === fn) onSessionLost = null;
  };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = `فشل الطلب (${res.status})`;
  let issues: unknown;
  try {
    const data = (await res.json()) as { error?: string; message?: string; issues?: unknown };
    if (data.error) code = data.error;
    if (data.message) message = data.message;
    if (data.issues) issues = data.issues;
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) message = 'انتهت الجلسة، يلزم تسجيل الدخول من جديد.';
  if (res.status === 403) message = 'هذا الإجراء غير مسموح.';
  return new ApiError(res.status, code, message, issues);
}

async function rawRequest<T>(path: string, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers['authorization'] = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'تعذّر الاتصال بالخادم. تأكد من تشغيل خدمة الـAPI.');
  }

  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await parseError(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await rawRequest<TokenResponse>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      auth: false,
    });
    accessToken = data.accessToken;
    setRefreshToken(data.refreshToken);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

/**
 * Refresh the access token using the stored refresh token.
 * Refresh tokens rotate on every use, so concurrent callers must share a single
 * in-flight request — otherwise the second one would replay an already-revoked token.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && opts.auth !== false) {
      const refreshed = await refreshSession();
      if (refreshed) return rawRequest<T>(path, opts);
      onSessionLost?.();
    }
    throw err;
  }
}
