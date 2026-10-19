import { loadEnv } from './env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-only-insecure-secret-change-me') {
    throw new Error('Refusing to start in production with the default JWT_SECRET. Set JWT_SECRET in .env.');
  }
  const app = await buildServer({ env });
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Personal Life OS API listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
