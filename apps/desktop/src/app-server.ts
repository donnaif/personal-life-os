import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Content-Security-Policy for the packaged app: same-origin only, no remote code. */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Dev CSP additionally allows the Vite dev server websocket + eval-based HMR only when needed. */
export const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

export interface AppServerOptions {
  /** Directory containing the built web assets. */
  root: string;
  /** Upstream API origin, e.g. http://127.0.0.1:3100 */
  apiTarget: string;
  host?: string;
  /** Preferred loopback port; 0 (default) asks the OS for an ephemeral one. */
  port?: number;
  /** Ports tried in order when the preferred one is taken; 0 always ends the list. */
  portFallbacks?: number[];
  csp?: string;
  proxyTimeoutMs?: number;
  /**
   * Maps the renderer's /api/* path onto the API's own path space.
   * Defaults to stripping the /api prefix (the API serves /health, /tasks, ...),
   * mirroring the Vite dev proxy so both shells hit identical endpoints.
   */
  rewriteApiPath?: (pathname: string) => string;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface AppServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function securityHeaders(csp: string): Record<string, string> {
  return {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown, csp: string): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    ...securityHeaders(csp),
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Resolves a URL pathname to a file inside `root`, or null when it escapes or is malformed. */
export async function resolveStaticFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;

  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, `.${path.posix.normalize(decoded)}`);
  if (candidate !== rootPath && !candidate.startsWith(rootPath + path.sep)) return null;

  try {
    const stats = await fsp.stat(candidate);
    if (stats.isDirectory()) return null;
    // Re-check after resolving symlinks so a link cannot point outside the bundle.
    const [real, rootReal] = await Promise.all([fsp.realpath(candidate), fsp.realpath(rootPath)]);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

async function serveFile(
  res: ServerResponse,
  filePath: string,
  csp: string,
  method: string,
  req: IncomingMessage,
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const headers: Record<string, string> = {
    ...securityHeaders(csp),
    'content-type': MIME[ext] ?? 'application/octet-stream',
  };
  headers['cache-control'] = ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable';
  if (req.headers['if-none-match']) delete req.headers['if-none-match'];

  headers['content-length'] = String((await fsp.stat(filePath)).size);
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(fs.createReadStream(filePath), res);
}

export const DEFAULT_API_PREFIX_REWRITE = (pathname: string): string => {
  const stripped = pathname.replace(/^\/api(?=\/|$)/, '');
  if (!stripped.startsWith('/')) return `/${stripped}`;
  return stripped;
};

/** Preferred port first, then the fallbacks, then an OS-assigned port (0). */
export function buildPortCandidates(preferred?: number, fallbacks: readonly number[] = []): number[] {
  const candidates: number[] = [];
  if (preferred !== undefined && preferred !== 0) candidates.push(preferred);
  for (const fallback of fallbacks) {
    if (fallback !== 0 && !candidates.includes(fallback)) candidates.push(fallback);
  }
  candidates.push(0);
  return candidates;
}

function proxyToApi(
  req: IncomingMessage,
  res: ServerResponse,
  target: URL,
  upstreamPath: string,
  timeoutMs: number,
  log: AppServerOptions['log'],
): void {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers.host = target.host;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'http';

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: upstreamPath,
      headers,
      timeout: timeoutMs,
    },
    (upstreamRes) => {
      const responseHeaders: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders[key] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      pipeline(upstreamRes, res).catch(() => res.destroy());
    },
  );

  upstream.on('timeout', () => {
    upstream.destroy(new Error('timeout'));
  });
  upstream.on('error', (err: NodeJS.ErrnoException) => {
    log?.('proxy error', { code: err.code, message: err.message });
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'api_unreachable', message: 'تعذّر الوصول إلى خدمة البيانات.' }, APP_CSP);
    } else {
      res.destroy();
    }
  });

  req.pipe(upstream);
}

export async function startAppServer(opts: AppServerOptions): Promise<AppServer> {
  const root = path.resolve(opts.root);
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile)) {
    throw new Error(`web assets not found at ${root} (run the web build first)`);
  }

  const target = new URL(opts.apiTarget);
  const csp = opts.csp ?? APP_CSP;
  const host = opts.host ?? '127.0.0.1';
  const timeoutMs = opts.proxyTimeoutMs ?? 30_000;
  const rewriteApiPath = opts.rewriteApiPath ?? DEFAULT_API_PREFIX_REWRITE;

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const upstreamPath = `${rewriteApiPath(url.pathname)}${url.search}`;
      proxyToApi(req, res, target, upstreamPath, timeoutMs, opts.log);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed' }, csp);
      return;
    }

    void (async () => {
      const file = await resolveStaticFile(root, url.pathname);
      if (file) {
        await serveFile(res, file, csp, method, req);
        return;
      }
      // SPA fallback: extension-less paths are client routes.
      const lastSegment = path.posix.basename(url.pathname);
      if (!lastSegment.includes('.')) {
        await serveFile(res, indexFile, csp, method, req);
        return;
      }
      sendJson(res, 404, { error: 'not_found' }, csp);
    })().catch((err: unknown) => {
      opts.log?.('static error', { message: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) sendJson(res, 500, { error: 'static_error' }, csp);
      else res.destroy();
    });
  });

  server.on('clientError', (_err, socket) => {
    socket.destroy();
  });

  const candidates = buildPortCandidates(opts.port, opts.portFallbacks);
  let lastError: unknown = null;
  let bound = false;
  for (const candidate of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: unknown) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidate, host);
      });
      bound = true;
      if (candidate !== candidates[0]) opts.log?.('preferred port busy, using alternative', { port: candidate });
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!bound) {
    throw new Error(`could not bind any loopback port: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('unexpected server address');
  const port = address.port;
  opts.log?.('app server listening', { url: `http://${host}:${port}`, root, apiTarget: target.origin });
  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
