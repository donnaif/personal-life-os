import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { createDb, type Db } from './db.js';
import { resolveDbPath, type Env } from './env.js';
import { registerRoutes } from './routes.js';

export interface BuildOptions {
  env: Env;
  db?: Db;
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.env.NODE_ENV !== 'test' ? { level: 'info' } : false,
    bodyLimit: 1_048_576,
  });

  const db = opts.db ?? createDb(resolveDbPath(opts.env.DATABASE_URL));

  await app.register(cors, {
    origin: opts.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: opts.env.JWT_SECRET });

  app.decorate('db', db);
  app.decorate('env', opts.env);

  app.addHook('onClose', async () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  await registerRoutes(app, opts.env);
  return app;
}
