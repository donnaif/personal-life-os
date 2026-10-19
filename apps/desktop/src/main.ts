import { app, BrowserWindow, ipcMain, Menu, Notification, safeStorage, screen, session, Tray, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_CSP, DEV_CSP, startAppServer, type AppServer } from './app-server.js';
import { resolveConfig, type DesktopConfig } from './config.js';
import {
  DEFAULT_LEAD_MINUTES,
  notificationText,
  sanitizeDueSessions,
  selectNotifiableSessions,
} from './notifications.js';
import { createLocalStateStore } from './local-state.js';
import { createSettingsStore, MAX_NOTIFIED_IDS, type WindowBounds } from './settings-store.js';
import { runVerification, type VerificationResult } from './verify.js';

const APP_USER_MODEL_ID = 'com.lifeos.desktop';
const MAX_CRYPTO_CHARS = 8_192;

const config: DesktopConfig = resolveConfig({
  argv: process.argv.slice(1),
  env: process.env,
  distDir: __dirname,
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});

// Isolated profile (used by the smoke verification so it never mutates the real one).
if (config.profileDir) app.setPath('userData', path.resolve(config.profileDir));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appServer: AppServer | null = null;
let quitting = false;

const settingsFile = path.join(app.getPath('userData'), 'desktop-settings.json');
const settingsStore = createSettingsStore(settingsFile);

/**
 * Profile-backed storage for the encrypted refresh token. Kept out of the
 * renderer's origin-scoped localStorage so a session survives port changes
 * and app updates.
 */
const localState = createLocalStateStore(path.join(app.getPath('userData'), 'desktop-state.json'));

function log(message: string, data?: Record<string, unknown>): void {
  if (!config.verbose && !config.smoke) return;
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  process.stdout.write(`[lifeos-desktop] ${message}${suffix}\n`);
}

function assetsDir(): string {
  return app.isPackaged ? path.join(app.getAppPath(), 'assets') : path.resolve(__dirname, '..', 'assets');
}

function trayIconPath(): string | null {
  const icon = path.join(assetsDir(), 'icon.png');
  return fs.existsSync(icon) ? icon : null;
}

function windowIconPath(): string | null {
  const icon = path.join(assetsDir(), app.isPackaged ? 'icon.ico' : 'icon.png');
  return fs.existsSync(icon) ? icon : null;
}

function isVisibleOnAnyDisplay(bounds: WindowBounds): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return true;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x! < area.x + area.width &&
      bounds.x! + bounds.width > area.x &&
      bounds.y! < area.y + area.height &&
      bounds.y! + bounds.height > area.y
    );
  });
}

function currentApiBase(): string {
  const override = settingsStore.read().apiBaseUrl;
  return override ?? config.apiBaseUrl;
}

function applyCsp(): void {
  const csp = config.devServerUrl ? DEV_CSP : APP_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function denyPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function hardenWebContents(win: BrowserWindow): void {
  const allowedOrigin = config.devServerUrl ? new URL(config.devServerUrl).origin : appServer ? new URL(appServer.url).origin : '';

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-navigate', (event, url) => {
    const target = (() => {
      try {
        return new URL(url);
      } catch {
        return null;
      }
    })();
    if (!target || target.origin !== allowedOrigin) {
      event.preventDefault();
      log('blocked navigation', { url });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log('renderer gone', { reason: details.reason });
  });
}

function createWindow(): BrowserWindow {
  const savedBounds = settingsStore.read().windowBounds;
  const bounds = savedBounds && isVisibleOnAnyDisplay(savedBounds) ? savedBounds : null;
  const icon = windowIconPath();

  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 840,
    ...(bounds?.x !== undefined ? { x: bounds.x } : {}),
    ...(bounds?.y !== undefined ? { y: bounds.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Personal Life OS',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  hardenWebContents(win);

  win.once('ready-to-show', () => {
    if (config.smoke) win.showInactive();
    else win.show();
  });

  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (win.isDestroyed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const live = win.isMaximized() ? null : win.getNormalBounds();
      settingsStore.update({ windowBounds: live ?? settingsStore.read().windowBounds });
    }, 400);
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  win.on('close', (event) => {
    if (!quitting && settingsStore.read().minimizeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

function buildMenu(): void {
  const isArabic = (app.getLocale() ?? '').toLowerCase().startsWith('ar');
  const settings = settingsStore.read();
  const t = (ar: string, en: string) => (isArabic ? ar : en);

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('ملف', 'File'),
      submenu: [
        {
          label: t('الإعدادات', 'Settings'),
          click: () => mainWindow?.webContents.send('lifeos:navigate', '/settings'),
        },
        { type: 'separator' },
        { label: t('خروج', 'Quit'), role: 'quit' },
      ],
    },
    {
      label: t('عرض', 'View'),
      submenu: [
        { label: t('تحديث', 'Reload'), role: 'reload' },
        { label: t('تكبير', 'Zoom In'), role: 'zoomIn' },
        { label: t('تصغير', 'Zoom Out'), role: 'zoomOut' },
        { label: t('الحجم الأصلي', 'Reset Zoom'), role: 'resetZoom' },
        ...(app.isPackaged
          ? []
          : [{ type: 'separator' as const }, { label: 'DevTools', role: 'toggleDevTools' as const }]),
      ],
    },
    {
      label: t('النافذة', 'Window'),
      submenu: [{ label: t('تصغير', 'Minimize'), role: 'minimize' }, { label: t('إغلاق', 'Close'), role: 'close' }],
    },
    {
      label: t('إشعارات', 'Notifications'),
      submenu: [
        {
          label: t('تفعيل إشعارات الجلسات', 'Enable session notifications'),
          type: 'checkbox',
          checked: settings.notificationsEnabled,
          click: (item) => {
            settingsStore.update({ notificationsEnabled: item.checked });
            pushSettings();
          },
        },
        {
          label: t('تقليل إلى شريط المهام عند الإغلاق', 'Close to tray'),
          type: 'checkbox',
          checked: settings.minimizeToTray,
          click: (item) => {
            settingsStore.update({ minimizeToTray: item.checked });
            pushSettings();
          },
        },
      ],
    },
    {
      role: 'help',
      label: t('مساعدة', 'Help'),
      submenu: [
        { label: t('حول التطبيق', 'About'), click: () => app.showAboutPanel() },
        { type: 'separator' },
        {
          label: t('عنوان خدمة البيانات', 'API base URL') + `: ${currentApiBase()}`,
          enabled: false,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function pushSettings(): void {
  mainWindow?.webContents.send('lifeos:settings', settingsStore.read());
}

function createTray(): void {
  const icon = trayIconPath();
  if (!icon) return;
  try {
    tray = new Tray(nativeImage.createFromPath(icon));
  } catch {
    return;
  }
  const isArabic = (app.getLocale() ?? '').toLowerCase().startsWith('ar');
  const t = (ar: string, en: string) => (isArabic ? ar : en);
  tray.setToolTip('Personal Life OS');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: t('إظهار النافذة', 'Show window'),
        click: () => {
          if (!mainWindow) return;
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: t('تفعيل إشعارات الجلسات', 'Enable session notifications'),
        type: 'checkbox',
        checked: settingsStore.read().notificationsEnabled,
        click: (item) => {
          settingsStore.update({ notificationsEnabled: item.checked });
          pushSettings();
          buildMenu();
        },
      },
      { type: 'separator' },
      {
        label: t('خروج', 'Quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function notifyDueSessions(rawSessions: unknown): { shown: number; skipped: number } {
  const existing = settingsStore.read().notifiedSessionIds;
  const already = new Set(existing);
  const due = sanitizeDueSessions(rawSessions);
  const enabled = settingsStore.read().notificationsEnabled && Notification.isSupported();

  const selected = selectNotifiableSessions(due, { enabled, already, leadMinutes: DEFAULT_LEAD_MINUTES });
  const isArabic = !(app.getLocale() ?? '').toLowerCase().startsWith('en');

  for (const session of selected) {
    const text = notificationText(session, isArabic ? 'ar' : 'en');
    const notification = new Notification({ title: text.title, body: text.body, silent: false });
    notification.on('click', () => {
      if (!mainWindow) return;
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('lifeos:navigate', '/dashboard');
    });
    notification.show();
  }

  if (selected.length > 0) {
    const nextIds = [...existing, ...selected.map((s) => s.id)].slice(-MAX_NOTIFIED_IDS);
    settingsStore.update({ notifiedSessionIds: nextIds });
  }

  return { shown: selected.length, skipped: due.length - selected.length };
}

function registerIpc(): void {
  ipcMain.handle('lifeos:info', () => ({
    name: 'Personal Life OS',
    version: app.getVersion(),
    platform: process.platform,
    locale: app.getLocale(),
    apiBaseUrl: currentApiBase(),
    packaged: app.isPackaged,
    dev: Boolean(config.devServerUrl),
    encryptionAvailable: safeEncryptionAvailable(),
    defaultLocale: isArabicLocale() ? 'ar' : 'en',
  }));

  ipcMain.handle('lifeos:get-settings', () => settingsStore.read());

  ipcMain.handle('lifeos:set-notifications-enabled', (_event, value: unknown) => {
    const enabled = value === true;
    if (enabled && !Notification.isSupported()) {
      return { ...settingsStore.read(), notificationsEnabled: false, unsupported: true };
    }
    const next = settingsStore.update({ notificationsEnabled: enabled });
    buildMenu();
    pushSettings();
    return next;
  });

  ipcMain.handle('lifeos:notify-due-sessions', (_event, payload: unknown) => notifyDueSessions(payload));

  ipcMain.on('lifeos:secure-encrypt', (event, value: unknown) => {
    event.returnValue = encryptString(value);
  });
  ipcMain.on('lifeos:secure-decrypt', (event, value: unknown) => {
    event.returnValue = decryptString(value);
  });

  ipcMain.on('lifeos:state-get', (event, key: unknown) => {
    event.returnValue = localState.get(typeof key === 'string' ? key : '');
  });
  ipcMain.on('lifeos:state-set', (event, payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const { key, value } = payload as { key?: unknown; value?: unknown };
      if (typeof key === 'string') {
        if (value === null) localState.set(key, null);
        else if (typeof value === 'string') localState.set(key, value);
      }
    }
    event.returnValue = true;
  });
}

function isArabicLocale(): boolean {
  const locale = (app.getLocale() ?? '').toLowerCase();
  if (locale.startsWith('ar')) return true;
  if (locale.startsWith('en')) return false;
  return true;
}

function safeEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CRYPTO_CHARS) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(value).toString('base64');
  } catch {
    return null;
  }
}

function decryptString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CRYPTO_CHARS * 2) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return null;
  }
}

function credentialsFromEnv(): { email: string; password: string } | undefined {
  const email = process.env.LIFEOS_E2E_EMAIL;
  const password = process.env.LIFEOS_E2E_PASSWORD;
  if (!email || !password) return undefined;
  return { email, password };
}

async function runSmoke(win: BrowserWindow): Promise<void> {
  const shotIndex = process.argv.findIndex((arg) => arg.startsWith('--shot='));
  const shotPath =
    shotIndex >= 0 ? process.argv[shotIndex]!.slice('--shot='.length) : path.join(app.getPath('userData'), 'smoke.png');

  const credentials = credentialsFromEnv();
  let result: VerificationResult;
  try {
    result = await runVerification(win, {
      apiBaseUrl: currentApiBase(),
      ...(appServer ? { appUrl: appServer.url } : {}),
      shotPath,
      ...(credentials ? { credentials } : {}),
    });
  } catch (err) {
    result = {
      ok: false,
      steps: [{ name: 'verification-crashed', ok: false, detail: err instanceof Error ? err.message : String(err) }],
      consoleErrors: [],
    };
  }

  const payload = {
    ok: result.ok,
    apiBaseUrl: currentApiBase(),
    appUrl: appServer?.url ?? config.devServerUrl ?? null,
    encryptionAvailable: safeEncryptionAvailable(),
    steps: result.steps,
    consoleErrors: result.consoleErrors,
    screenshot: result.screenshot ?? null,
  };
  // GUI builds on Windows have no attached console, so mirror the report to disk too.
  try {
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath.replace(/\.png$/i, '') + '.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    /* best effort: stdout is still emitted for console builds */
  }
  process.stdout.write(`SMOKE_RESULT ${JSON.stringify(payload)}\n`);
  quitting = true;
  app.exit(result.ok ? 0 : 1);
}

async function boot(): Promise<void> {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  await app.whenReady();

  applyCsp();
  denyPermissions();
  registerIpc();
  buildMenu();
  createTray();

  const indexHtml = path.join(config.webRoot, 'index.html');
  if (!config.devServerUrl && !fs.existsSync(indexHtml)) {
    process.stderr.write(
      `[lifeos-desktop] web assets missing at ${config.webRoot}\nrun: npm run build --workspace @lifeos/web\n`,
    );
    app.exit(2);
    return;
  }

  if (!config.devServerUrl) {
    try {
      appServer = await startAppServer({
        root: config.webRoot,
        apiTarget: currentApiBase(),
        port: config.serverPort,
        portFallbacks: config.serverPortFallbacks,
        log: config.verbose ? log : undefined,
      });
    } catch (err) {
      process.stderr.write(`[lifeos-desktop] failed to start app server: ${err instanceof Error ? err.message : String(err)}\n`);
      app.exit(3);
      return;
    }
  }

  mainWindow = createWindow();
  const target = config.devServerUrl ?? appServer!.url;
  log('loading', { target, apiBase: currentApiBase() });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (config.smoke) setTimeout(() => void runSmoke(mainWindow!), 600);
  });
  mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
    process.stderr.write(`[lifeos-desktop] load failed ${code} ${description}\n`);
    if (config.smoke) {
      process.stdout.write(`SMOKE_RESULT ${JSON.stringify({ ok: false, errors: [`load failed ${code} ${description}`] })}\n`);
      quitting = true;
      app.exit(1);
    }
  });

  await mainWindow.loadURL(target);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  const server = appServer;
  appServer = null;
  if (server) void server.close();
});

void boot().catch((err: unknown) => {
  process.stderr.write(`[lifeos-desktop] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  app.exit(1);
});
