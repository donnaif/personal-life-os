import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(here, '..', 'assets');

let buildIcons;
try {
  ({ buildIcons } = require(path.resolve(here, '..', 'dist', 'icon.js')));
} catch (err) {
  process.stderr.write(`make-icon: run "npm run build" first (${err.message})\n`);
  process.exit(1);
}

const { png, ico, size } = buildIcons(256);
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(path.join(targetDir, 'icon.png'), png);
fs.writeFileSync(path.join(targetDir, 'icon.ico'), ico);
process.stdout.write(`make-icon: wrote ${size}x${size} icon.png (${png.length}B) and icon.ico (${ico.length}B)\n`);
