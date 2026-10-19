import { z } from 'zod';

export const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-change-me';
export const MIN_PRODUCTION_SECRET_CHARS = 32;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3100),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGINS: z.string().default('http://localhost:3101'),
  DATABASE_URL: z.string().default('file:./data/lifeos.sqlite'),
  JWT_SECRET: z.string().min(16).default(DEV_FALLBACK_SECRET),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  // A shipped default secret must never protect real data: fail loudly at startup instead.
  if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET === DEV_FALLBACK_SECRET) {
      throw new Error('Invalid environment: JWT_SECRET is still the development default — set a real secret in production');
    }
    if (env.JWT_SECRET.length < MIN_PRODUCTION_SECRET_CHARS) {
      throw new Error(
        `Invalid environment: JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_CHARS} characters in production`,
      );
    }
  }
  return env;
}

/** Resolve the SQLite file path from a `file:` DATABASE_URL (or `:memory:`). */
export function resolveDbPath(databaseUrl: string): string {
  if (databaseUrl === ':memory:' || databaseUrl === 'file::memory:') return ':memory:';
  return databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
}
