import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveStaticFile, startAppServer, type AppServer } from '../src/app-server.js';

interface UpstreamHit {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

let tmpDir = '';
let webRoot = '';
let upstream: Server;
let upstreamPort = 0;
let server: AppServer;
let hits: UpstreamHit[] = [];

async function listen(server_: Server): Promise<number> {
  await new Promise<void>((resolve) => server_.listen(0, '127.0.0.1', () => resolve()));
  const address = server_.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function fetchRaw(port: number, requestPath: string, method = 'GET', body?: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-desktop-'));
  webRoot = path.join(tmpDir, 'web');
  fs.mkdirSync(path.join(webRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Life OS shell</title><div id="root"></div>');
  fs.writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'console.log("shell");');
  fs.writeFileSync(path.join(tmpDir, 'secret.txt'), 'TOP SECRET');

  hits = [];
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      hits.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url, method: req.method }));
    });
  });
  upstreamPort = await listen(upstream);

  server = await startAppServer({
    root: webRoot,
    apiTarget: `http://127.0.0.1:${upstreamPort}`,
    proxyTimeoutMs: 5_000,
  });
});

afterAll(async () => {
  await server?.close();
  await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('desktop app server', () => {
  it('serves the SPA shell with security headers', async () => {
    const res = await fetchRaw(server.port, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Life OS shell');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('serves hashed assets with immutable caching', async () => {
    const res = await fetchRaw(server.port, '/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.body).toContain('shell');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await fetchRaw(server.port, '/reports');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Life OS shell');
  });

  it('returns 404 for a missing asset', async () => {
    const res = await fetchRaw(server.port, '/assets/missing.js');
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'not_found' });
  });

  it('rejects non read-only methods on static paths', async () => {
    const res = await fetchRaw(server.port, '/', 'POST', '{}');
    expect(res.status).toBe(405);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'method_not_allowed' });
  });

  it('blocks encoded path traversal', async () => {
    const res = await fetchRaw(server.port, '/%2e%2e/secret.txt');
    expect(res.body).not.toContain('TOP SECRET');
    expect(res.status).toBe(404);
  });

  it('resolves only files inside the web root', async () => {
    expect(await resolveStaticFile(webRoot, '/index.html')).toContain('index.html');
    expect(await resolveStaticFile(webRoot, '/../secret.txt')).toBeNull();
    expect(await resolveStaticFile(webRoot, '/%2e%2e%2fsecret.txt')).toBeNull();
    expect(await resolveStaticFile(webRoot, '/../../etc/passwd')).toBeNull();
    expect(await resolveStaticFile(webRoot, '/assets')).toBeNull();
  });

  it('proxies /api requests to the API target with headers and body intact', async () => {
    const res = await fetchRaw(
      server.port,
      '/api/tasks?limit=2',
      'POST',
      JSON.stringify({ title: 'وكالة' }),
      { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, url: '/tasks?limit=2', method: 'POST' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.authorization).toBe('Bearer test-token');
    expect(hits[0]!.body).toBe(JSON.stringify({ title: 'وكالة' }));
  });

  it('strips the /api prefix exactly like the development proxy', async () => {
    hits.length = 0;
    await fetchRaw(server.port, '/api');
    await fetchRaw(server.port, '/api/health');
    await fetchRaw(server.port, '/apiary');
    expect(hits.map((hit) => hit.url)).toEqual(['/', '/health']);
    const spa = await fetchRaw(server.port, '/apiary');
    expect(spa.body).toContain('Life OS shell');
  });

  it('keeps the preferred port and falls back when it is taken', async () => {
    const busy = http.createServer();
    const busyPort = await listen(busy);
    const first = await startAppServer({
      root: webRoot,
      apiTarget: `http://127.0.0.1:${upstreamPort}`,
      port: busyPort,
      portFallbacks: [],
    });
    try {
      expect(first.port).not.toBe(busyPort);
      expect(first.port).toBeGreaterThan(0);
    } finally {
      await first.close();
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }

    const holder = await startAppServer({ root: webRoot, apiTarget: `http://127.0.0.1:${upstreamPort}`, port: busyPort });
    const free = await (async () => {
      const probe = http.createServer();
      const port = await listen(probe);
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      return port;
    })();
    const alternate = await startAppServer({
      root: webRoot,
      apiTarget: `http://127.0.0.1:${upstreamPort}`,
      port: busyPort,
      portFallbacks: [free],
    });
    try {
      expect(holder.port).toBe(busyPort);
      expect(alternate.port).toBe(free);
      expect((await fetchRaw(alternate.port, '/')).status).toBe(200);
    } finally {
      await Promise.all([holder.close(), alternate.close()]);
    }
  });

  it('reports an unreachable API as 502 instead of hanging', async () => {
    const deadPort = await (async () => {
      const probe = http.createServer();
      const port = await listen(probe);
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      return port;
    })();
    const isolated = await startAppServer({
      root: webRoot,
      apiTarget: `http://127.0.0.1:${deadPort}`,
      proxyTimeoutMs: 2_000,
    });
    try {
      const res = await fetchRaw(isolated.port, '/api/health');
      expect(res.status).toBe(502);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'api_unreachable' });
    } finally {
      await isolated.close();
    }
  });
});
