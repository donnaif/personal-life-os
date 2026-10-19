import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  isDesktop: true as const,
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('lifeos:info'),
  getSettings: () => ipcRenderer.invoke('lifeos:get-settings'),
  setNotificationsEnabled: (value: boolean) => ipcRenderer.invoke('lifeos:set-notifications-enabled', value === true),
  reportDueSessions: (sessions: unknown) => ipcRenderer.invoke('lifeos:notify-due-sessions', sessions),
  onSettingsChanged: (handler: (settings: unknown) => void) => subscribe('lifeos:settings', handler),
  onNavigate: (handler: (path: string) => void) =>
    subscribe('lifeos:navigate', (payload) => {
      if (typeof payload === 'string') handler(payload);
    }),
  tokenCrypto: {
    encrypt: (plain: string): string | null =>
      typeof plain === 'string' ? (ipcRenderer.sendSync('lifeos:secure-encrypt', plain) as string | null) : null,
    decrypt: (cipher: string): string | null =>
      typeof cipher === 'string' ? (ipcRenderer.sendSync('lifeos:secure-decrypt', cipher) as string | null) : null,
  },
  /**
   * Storage in the app profile instead of the renderer origin, so a session is
   * not tied to the loopback port of a single launch.
   */
  secureStorage: {
    getItem: (key: string): string | null =>
      typeof key === 'string' ? (ipcRenderer.sendSync('lifeos:state-get', key) as string | null) : null,
    setItem: (key: string, value: string): void => {
      if (typeof key === 'string' && typeof value === 'string') {
        ipcRenderer.sendSync('lifeos:state-set', { key, value });
      }
    },
    removeItem: (key: string): void => {
      if (typeof key === 'string') ipcRenderer.sendSync('lifeos:state-set', { key, value: null });
    },
  },
};

contextBridge.exposeInMainWorld('lifeosDesktop', api);
