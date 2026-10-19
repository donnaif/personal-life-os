import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const webDist = path.join(repoRoot, 'apps', 'web', 'dist');
const stageDir = path.join(desktopDir, '.stage');
const stagedWeb = path.join(stageDir, 'web');
const outDir = path.join(desktopDir, 'release');
const iconPath = path.join(desktopDir, 'assets', 'icon.ico');

function fail(message) {
  process.stderr.write(`package:win: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  fail(`web build missing at ${webDist}. Run: npm run build --workspace @lifeos/web`);
}
if (!fs.existsSync(path.join(desktopDir, 'dist', 'main.js'))) {
  fail('desktop build missing. Run: npm run build');
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stagedWeb, { recursive: true });
fs.cpSync(webDist, stagedWeb, { recursive: true });

const paths = await packager({
  dir: desktopDir,
  out: outDir,
  name: 'Personal Life OS',
  appVersion: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  asar: true,
  overwrite: true,
  prune: true,
  ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
  extraResource: [stagedWeb],
  ignore: [
    /^\/src($|\/)/,
    /^\/test($|\/)/,
    /^\/scripts($|\/)/,
    /^\/release($|\/)/,
    /^\/\.stage($|\/)/,
    /^\/tsconfig\.json$/,
    /^\/package-lock\.json$/,
    /\.tsbuildinfo$/,
    /^\/dist\/.*\.map$/,
  ],
  win32metadata: {
    CompanyName: 'Personal Life OS',
    FileDescription: 'Personal Life OS',
    ProductName: 'Personal Life OS',
    InternalName: 'lifeos-desktop',
    OriginalFilename: 'Personal Life OS.exe',
  },
});

fs.rmSync(stageDir, { recursive: true, force: true });

const appDir = paths[0];
const exePath = path.join(appDir, 'Personal Life OS.exe');
const bundledWeb = path.join(appDir, 'resources', 'web', 'index.html');
const ok = Boolean(appDir) && fs.existsSync(exePath) && fs.existsSync(bundledWeb);
process.stdout.write(
  `package:win: ${ok ? 'ok' : 'FAILED'} -> ${appDir ?? 'no output'}\n` +
    `package:win: exe ${fs.existsSync(exePath) ? exePath : 'missing'}\n` +
    `package:win: web assets ${fs.existsSync(bundledWeb) ? 'bundled at resources/web' : 'MISSING'}\n`,
);
process.exit(ok ? 0 : 1);
