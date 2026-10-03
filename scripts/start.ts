import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'src-tauri/target/release/bundle/macos/BlackHole Visualizer.app');
const executable = join(app, 'Contents/MacOS/blackhole-visualizer');

function newestSource(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...readdirSync(path)
    .filter((name) => !['target', 'gen', '.DS_Store'].includes(name))
    .map((name) => newestSource(join(path, name))));
}

if (process.platform !== 'darwin') {
  console.error('BlackHole Visualizer currently requires macOS.');
  process.exit(1);
}

const newest = Math.max(...[
  'src', 'index.html', 'src-tauri', 'package.json', 'package-lock.json',
  'vite.config.ts', 'tsconfig.json',
].map((path) => newestSource(join(root, path))));

if (!existsSync(executable) || newest > statSync(executable).mtimeMs) {
  console.log('Building BlackHole Visualizer… (the first native build takes a few minutes)');
  const result = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Opening BlackHole Visualizer. Route your audio to BlackHole, then click Start.');
const result = spawnSync('/usr/bin/open', [app], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
