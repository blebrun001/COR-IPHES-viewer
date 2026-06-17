import { access, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const macBundleDir = resolve(root, 'src-tauri', 'target', 'release', 'bundle', 'macos');
const appPath = resolve(macBundleDir, 'COR-IPHES Esqueletos Off-linea.app');
const appBinary = resolve(appPath, 'Contents', 'MacOS', 'cor-iphes-esqueletos-off-linea');
const appZip = resolve(macBundleDir, 'COR-IPHES-Esqueletos-Off-linea-macos.app.zip');

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function ensureExecutable(path) {
  await access(path, constants.X_OK);
}

async function smokeLaunchMacApp() {
  if (process.platform !== 'darwin') {
    console.log('Skipping macOS app launch smoke check on non-Darwin host.');
    return;
  }

  await ensureExecutable(appBinary);
  console.log(`\n$ ${appBinary}`);
  const child = spawn(appBinary, [], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const exit = await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
      resolveExit({ ok: true, reason: 'alive-after-timeout' });
    }, 8000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ ok: false, code, signal });
    });
  });

  if (!exit.ok) {
    console.error(output.split('\n').slice(0, 120).join('\n'));
    throw new Error(`macOS app exited during smoke check: code=${exit.code} signal=${exit.signal}`);
  }

  console.log('macOS app launch smoke check passed.');
}

async function verifyArtifacts() {
  const appStats = await stat(appPath);
  const zipStats = await stat(appZip);
  if (!appStats.isDirectory()) {
    throw new Error(`${appPath} is not an app directory`);
  }
  if (!zipStats.isFile() || zipStats.size <= 0) {
    throw new Error(`${appZip} is missing or empty`);
  }
  console.log(`Verified macOS .app at ${appPath}`);
  console.log(`Verified macOS .zip at ${appZip} (${zipStats.size} bytes)`);
}

run('npm', ['test']);
run('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--ignored', '--test-threads=1']);
run('npm', ['run', 'tauri:build:mac']);

await rm(appZip, { force: true });
run('ditto', [
  '-c',
  '-k',
  '--sequesterRsrc',
  '--keepParent',
  appPath,
  appZip,
]);

await verifyArtifacts();
await smokeLaunchMacApp();

console.log('\nLocal release validation passed.');
