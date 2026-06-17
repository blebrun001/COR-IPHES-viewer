import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = resolve(root, 'tests');
const entries = await readdir(testsDir);
const testFiles = entries
  .filter((entry) => entry.endsWith('.test.js'))
  .sort()
  .map((entry) => resolve(testsDir, entry));

if (testFiles.length === 0) {
  throw new Error(`No JavaScript test files found in ${testsDir}`);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
