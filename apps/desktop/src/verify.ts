import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface VerificationStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerificationOptions {
  apiBaseUrl: string;
  appUrl?: string;
  shotPath: string;
  credentials?: { email: string; password: string };
  timeoutMs?: number;
}

export interface VerificationResult {
  ok: boolean;
  steps: VerificationStep[];
  screenshot?: string;
  consoleErrors: string[];
}

type LooseWebContents = {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  executeJavaScript: (code: string) => Promise<unknown>;
  capturePage: () => Promise<{ toPNG: () => Buffer }>;
  reload: () => void;
  getLastWebPreferences: () => Record<string, unknown> | undefined;
};

function asWebContents(win: BrowserWindow): LooseWebContents {
  return win.webContents as unknown as LooseWebContents;
}

function readConsoleMessage(args: unknown[]): { level: number; message: string } | null {
  const first = args[0];
  if (first && typeof first === 'object') {
    const record = first as { level?: unknown; message?: unknown };
    const level = typeof record.level === 'number' ? record.level : typeof record.level === 'string' ? NaN : NaN;
    return {
      level: Number.isNaN(level) ? 2 : level,
      message: typeof record.message === 'string' ? record.message : '',
    };
  }
  const level = typeof args[0] === 'number' ? args[0] : 2;
  const message = typeof args[1] === 'string' ? args[1] : '';
  return { level, message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  wc: LooseWebContents,
  expression: string,
  timeoutMs: number,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await wc.executeJavaScript(`Boolean(${expression})`);
      if (value === true) return true;
    } catch {
      /* page may be mid-navigation */
    }
    await sleep(intervalMs);
  }
  return false;
}

const LOGIN_SCRIPT = (email: string, password: string): string => `
(() => {
  const setValue = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const form = document.querySelector('form');
  if (!form) return 'no-form';
  const emailInput = form.querySelector('input[type="email"]');
  const passInput = form.querySelector('input[type="password"]');
  if (!emailInput || !passInput) return 'no-inputs';
  setValue(emailInput, ${JSON.stringify(email)});
  setValue(passInput, ${JSON.stringify(password)});
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) return 'no-submit';
  submit.click();
  return 'submitted';
})()`;

export async function runVerification(win: BrowserWindow, opts: VerificationOptions): Promise<VerificationResult> {
  const wc = asWebContents(win);
  const steps: VerificationStep[] = [];
  const consoleErrors: string[] = [];
  const timeoutMs = opts.timeoutMs ?? 20_000;

  wc.on('console-message', (...args: unknown[]) => {
    const parsed = readConsoleMessage(args);
    if (parsed && parsed.level >= 3 && parsed.message) consoleErrors.push(parsed.message);
  });

  const add = (name: string, ok: boolean, detail?: string) => {
    steps.push(detail === undefined ? { name, ok } : { name, ok, detail });
  };

  const prefs = wc.getLastWebPreferences() ?? {};
  add('window-security', prefs.contextIsolation === true && prefs.nodeIntegration !== true && prefs.sandbox === true,
    `contextIsolation=${String(prefs.contextIsolation)} nodeIntegration=${String(prefs.nodeIntegration)} sandbox=${String(prefs.sandbox)}`);

  const ready = await waitFor(wc, `document.getElementById('root')?.childElementCount > 0`, timeoutMs);
  add('renderer-rendered', ready);

  const env = (await wc.executeJavaScript(
    `(() => ({
       bridge: Object.keys(window.lifeosDesktop || {}),
       nodeAbsent: typeof window.require === 'undefined' && typeof window.process === 'undefined',
       href: location.href,
       authenticated: !!document.querySelector('.app__sidebar'),
     }))()`,
  )) as { bridge: string[]; nodeAbsent: boolean; href: string; authenticated: boolean };
  add('preload-bridge', env.bridge.includes('getInfo') && env.bridge.includes('tokenCrypto') && env.bridge.includes('reportDueSessions'), env.bridge.join(','));
  add('no-node-in-renderer', env.nodeAbsent);

  if (env.bridge.includes('reportDueSessions')) {
    const notifications = (await wc.executeJavaScript(
      `(async () => {
         const bridge = window.lifeosDesktop;
         const before = await bridge.getSettings();
         const synthetic = [{ id: 'verify-session-' + Date.now(), title: 'تحقق آلي', startAt: new Date(Date.now() + 120000).toISOString() }];
         const whileOff = await bridge.reportDueSessions(synthetic);
         await bridge.setNotificationsEnabled(true);
         const first = await bridge.reportDueSessions(synthetic);
         const second = await bridge.reportDueSessions(synthetic);
         const stale = await bridge.reportDueSessions([{ id: 'verify-stale-' + Date.now(), title: 'قديمة', startAt: new Date(Date.now() - 3600000).toISOString() }]);
         await bridge.setNotificationsEnabled(before.notificationsEnabled);
         const after = await bridge.getSettings();
         return {
           whileOffShown: whileOff.shown,
           firstShown: first.shown,
           secondShown: second.shown,
           staleShown: stale.shown,
           restored: after.notificationsEnabled === before.notificationsEnabled,
         };
       })()`,
    )) as {
      whileOffShown: number;
      firstShown: number;
      secondShown: number;
      staleShown: number;
      restored: boolean;
    };
    add('notifications-opt-in', notifications.whileOffShown === 0, `shown while disabled=${notifications.whileOffShown}`);
    add('notifications-delivered-once', notifications.firstShown === 1 && notifications.secondShown === 0 && notifications.staleShown === 0,
      `first=${notifications.firstShown} repeat=${notifications.secondShown} stale=${notifications.staleShown}`);
    add('notifications-setting-restored', notifications.restored);
  }

  if (opts.appUrl) {
    try {
      const res = await fetch(new URL('/', opts.appUrl));
      const csp = res.headers.get('content-security-policy') ?? '';
      add('csp-header', csp.includes("default-src 'self'"), csp.slice(0, 60));
    } catch (err) {
      add('csp-header', false, err instanceof Error ? err.message : String(err));
    }
  }

  let apiOk = false;
  try {
    const res = await fetch(new URL('/health', opts.apiBaseUrl), { signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as { status?: string };
    apiOk = res.ok && body.status === 'ok';
    add('api-reachable', apiOk, `${res.status} ${JSON.stringify(body)}`);
  } catch (err) {
    add('api-reachable', false, err instanceof Error ? err.message : String(err));
  }

  if (apiOk && opts.credentials) {
    if (!env.authenticated) {
      const outcome = (await wc.executeJavaScript(LOGIN_SCRIPT(opts.credentials.email, opts.credentials.password))) as string;
      add('login-submitted', outcome === 'submitted', outcome);
      const loggedIn = await waitFor(wc, `!!document.querySelector('.app__sidebar')`, timeoutMs);
      add('login-succeeded', loggedIn);
    } else {
      add('login-succeeded', true, 'already authenticated from a previous launch');
    }

    const storage = (await wc.executeJavaScript(
      `(() => {
         const bridge = window.lifeosDesktop;
         return {
           localStorageValue: localStorage.getItem('lifeos.refreshToken'),
           profileValue: bridge.secureStorage.getItem('lifeos.refreshToken'),
         };
       })()`,
    )) as { localStorageValue: string | null; profileValue: string | null };
    add('token-kept-out-of-localstorage', storage.localStorageValue === null, String(storage.localStorageValue).slice(0, 12));
    add(
      'refresh-token-encrypted',
      typeof storage.profileValue === 'string' && storage.profileValue.startsWith('enc:'),
      storage.profileValue ? `${storage.profileValue.slice(0, 12)}… (len ${storage.profileValue.length})` : 'missing',
    );

    const dashboardReady = await waitFor(wc, `document.body.innerText.includes('لوحة اليوم')`, timeoutMs);
    add('dashboard-rendered', dashboardReady);

    const dueReported = (await wc.executeJavaScript(
      `(() => typeof window.lifeosDesktop?.reportDueSessions === 'function')()`,
    )) as boolean;
    add('notifications-bridge-callable', dueReported === true);

    wc.reload();
    const persisted = await waitFor(wc, `!!document.querySelector('.app__sidebar')`, timeoutMs);
    add('session-persisted-after-reload', persisted);
  } else if (apiOk) {
    add('login-succeeded', false, 'no credentials supplied (set LIFEOS_E2E_EMAIL / LIFEOS_E2E_PASSWORD)');
  }

  let screenshot: string | undefined;
  try {
    // The compositor needs a painted frame; the reload above leaves the shell on its
    // session-check screen for a moment, so settle and force a fresh capture.
    await waitFor(wc, `!!document.querySelector('.app__sidebar') || !!document.querySelector('.auth__card')`, 5_000);
    await sleep(600);
    await wc.capturePage();
    await sleep(250);
    const image = await wc.capturePage();
    fs.mkdirSync(path.dirname(opts.shotPath), { recursive: true });
    fs.writeFileSync(opts.shotPath, image.toPNG());
    screenshot = opts.shotPath;
  } catch (err) {
    consoleErrors.push(`capture failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  add('no-console-errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

  return {
    ok: steps.every((step) => step.ok),
    steps,
    ...(screenshot ? { screenshot } : {}),
    consoleErrors,
  };
}
