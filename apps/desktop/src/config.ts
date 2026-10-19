import path from 'node:path';

export const DEFAULT_API_BASE = 'http://127.0.0.1:3100';
export const DEV_SERVER_DEFAULT = 'http://127.0.0.1:3101';

/**
 * Loopback port the shell serves its own UI on.
 * It must be stable across launches: the renderer origin (`http://127.0.0.1:<port>`)
 * scopes localStorage, so a changing port would drop the persisted session and theme
 * every time the app starts.
 */
export const DEFAULT_SERVER_PORT = 3105;
export const SERVER_PORT_FALLBACKS = [3106, 3107, 3102, 3103];

export interface DesktopConfig {
  /** Directory that holds the built web assets (apps/web/dist). */
  webRoot: string;
  /** Base URL of the Life OS API that /api/* requests are proxied to. */
  apiBaseUrl: string;
  /** Loopback port for the bundled UI server (kept stable, see DEFAULT_SERVER_PORT). */
  serverPort: number;
  /** Additional ports tried when the preferred one is busy. */
  serverPortFallbacks: number[];
  /** When set, the window loads this Vite dev server instead of the built assets. */
  devServerUrl?: string;
  /** Load, verify and exit without user interaction (CI / server verification). */
  smoke: boolean;
  /** Override the profile directory; verification runs use a throwaway one. */
  profileDir?: string;
  /** Print extra diagnostics to stdout. */
  verbose: boolean;
}

export function normalizeApiBase(raw: string | undefined | null): string {
  if (!raw) return DEFAULT_API_BASE;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return DEFAULT_API_BASE;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_API_BASE;
  if (!parsed.hostname) return DEFAULT_API_BASE;
  const withoutTrailingSlash = parsed.toString().replace(/\/+$/, '');
  return withoutTrailingSlash;
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function parsePort(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) return null;
  return value;
}

export interface ResolveConfigOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Absolute path of the compiled dist directory (__dirname at runtime). */
  distDir: string;
  /** True when running from a packaged build (web assets live in resources/web). */
  packaged?: boolean;
  /** process.resourcesPath of the packaged build. */
  resourcesPath?: string;
}

export function resolveConfig(opts: ResolveConfigOptions): DesktopConfig {
  const argv = opts.argv ?? [];
  const env = opts.env ?? {};

  const devFlag = argv.includes('--dev');
  const profileDir = argValue(argv, 'profile-dir') ?? env.LIFEOS_PROFILE_DIR ?? null;
  const devServerUrl = normalizeApiBase(
    argValue(argv, 'dev-server') ?? env.LIFEOS_DEV_SERVER ?? (devFlag ? DEV_SERVER_DEFAULT : undefined),
  );
  const packagedWebRoot =
    opts.packaged && opts.resourcesPath ? path.join(opts.resourcesPath, 'web') : null;

  return {
    webRoot: env.LIFEOS_WEB_ROOT ?? packagedWebRoot ?? path.resolve(opts.distDir, '..', '..', 'web', 'dist'),
    apiBaseUrl: normalizeApiBase(argValue(argv, 'api') ?? env.LIFEOS_API_URL),
    serverPort: parsePort(argValue(argv, 'port')) ?? parsePort(env.LIFEOS_DESKTOP_PORT) ?? DEFAULT_SERVER_PORT,
    serverPortFallbacks: [...SERVER_PORT_FALLBACKS],
    ...(devFlag ? { devServerUrl } : {}),
    smoke: argv.includes('--smoke') || env.LIFEOS_SMOKE === '1',
    ...(profileDir ? { profileDir } : {}),
    verbose: argv.includes('--verbose') || env.LIFEOS_VERBOSE === '1',
  };
}
