import { mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(root, 'src-tauri', 'target', 'release');
const outDir = resolve(root, 'src-tauri', 'target', 'release', 'portable');
await mkdir(outDir, { recursive: true });

const entries = await readdir(releaseDir);
const exe = entries.find((entry) => entry.endsWith('.exe'));
if (!exe) {
  throw new Error(`No Windows executable found in ${releaseDir}`);
}

const archive = resolve(outDir, 'COR-IPHES-Esqueletos-Off-linea-windows-portable.zip');
const result = spawnSync('powershell', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path "${resolve(releaseDir, exe)}" -DestinationPath "${archive}" -Force`,
], { stdio: 'inherit' });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
