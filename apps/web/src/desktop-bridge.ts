/**
 * Bridge to the desktop shell (Electron preload). `undefined` in a plain browser,
 * so every call site must stay functional without it.
 */

export interface DesktopInfo {
  name: string;
  version: string;
  platform: string;
  locale: string;
  apiBaseUrl: string;
  packaged: boolean;
  dev: boolean;
  encryptionAvailable: boolean;
  defaultLocale: 'ar' | 'en';
}

export interface DesktopSettings {
  notificationsEnabled: boolean;
  minimizeToTray: boolean;
  apiBaseUrl: string | null;
  windowBounds: { width: number; height: number; x?: number; y?: number } | null;
  notifiedSessionIds: string[];
}

export interface DueSessionReport {
  id: string;
  title: string;
  startAt: string;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  getInfo: () => Promise<DesktopInfo>;
  getSettings: () => Promise<DesktopSettings>;
  setNotificationsEnabled: (enabled: boolean) => Promise<DesktopSettings & { unsupported?: boolean }>;
  reportDueSessions: (sessions: DueSessionReport[]) => Promise<{ shown: number; skipped: number }>;
  onSettingsChanged: (handler: (settings: DesktopSettings) => void) => () => void;
  onNavigate: (handler: (path: string) => void) => () => void;
  /** OS-backed encryption (DPAPI/Keychain/libsecret) used to keep the refresh token off-disk in clear text. */
  tokenCrypto: {
    encrypt: (plain: string) => string | null;
    decrypt: (cipher: string) => string | null;
  };
  /** Profile-backed storage; unlike localStorage it is not scoped to a browser origin. */
  secureStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
}

declare global {
  interface Window {
    lifeosDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.lifeosDesktop;
  return bridge && bridge.isDesktop === true ? bridge : null;
}

export function isDesktop(): boolean {
  return getDesktopBridge() !== null;
}
