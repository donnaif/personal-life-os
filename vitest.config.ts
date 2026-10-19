import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // `node:sqlite` is a prefix-only Node builtin that older bundled Vite
      // versions cannot resolve. Route tests through a runtime shim instead.
      {
        find: /^node:sqlite$/,
        replacement: path.resolve(process.cwd(), 'apps/api/src/sqlite-shim.ts'),
      },
    ],
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/api/**/*.test.ts',
      'apps/web/test/**/*.test.ts',
      'apps/desktop/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    reporters: ['default'],
  },
});
