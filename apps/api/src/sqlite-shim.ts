/**
 * Runtime shim for `node:sqlite` used only by the test runner.
 *
 * Some bundled Vite/Vitest versions do not list `node:sqlite` in their Node
 * builtin snapshot, so a normal `import ... from 'node:sqlite'` fails to
 * resolve during test collection. Vitest aliases `node:sqlite` to this file,
 * which loads the real builtin through Node's own `require` at runtime.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

export const DatabaseSync = sqlite.DatabaseSync;
export type { DatabaseSync as DatabaseSyncInstance } from 'node:sqlite';
