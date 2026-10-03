import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = '0180df21f5e0bd39b9060cc5de420ed2f1f9e509';
const archiveSha256 = '77ef8e527fb00343afdfb267f5a2e8d3d00430c563ca9f5ab2104fc306f5c674';
const version = `cream-${revision}-converter-0.1.2-v2`;
const cache = join(root, '.cache/presets');
const source = join(cache, 'source');
const output = join(root, 'public/presets');
const generated = join(root, 'src/generated/preset-catalogue.json');
const manifestPath = join(output, 'manifest.json');
type Entry = { id: string; name: string; collection: string; category: string };
type Failure = { path: string; reason: string };
function atomicJson(path: string, value: unknown) { writeFileSync(`${path}.tmp`, JSON.stringify(value)); renameSync(`${path}.tmp`, path); }
function walk(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]); }
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
for (const path of [cache, source, join(output, 'cream'), join(output, 'builtin'), dirname(generated)]) mkdirSync(path, { recursive: true });
if (existsSync(manifestPath) && existsSync(generated)) {
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (previous.version === version && previous.entries.every((entry: Entry) => existsSync(join(output, `${entry.id}.json`)))) {
    console.log(`Presets ready: ${previous.entries.length} cached locally (${previous.skipped} conversion skips).`);
    process.exit(0);
  }
}
if (existsSync(join(source, '.source-revision')) && readFileSync(join(source, '.source-revision'), 'utf8') !== revision) throw new Error('Source revision changed; remove .cache/presets and public/presets before importing.');
if (!existsSync(join(source, '.source-revision'))) {
  console.log('Downloading pinned Cream of the Crop collection (first launch only)…');
  const archive = join(cache, 'cream.tar.gz');
  if (!existsSync(archive)) run('curl', ['--fail', '--location', '--retry', '2', '--max-time', '180', `https://codeload.github.com/projectM-visualizer/presets-cream-of-the-crop/tar.gz/${revision}`, '--output', `${archive}.tmp`]);
  if (!existsSync(archive)) renameSync(`${archive}.tmp`, archive);
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (digest !== archiveSha256) throw new Error('Preset archive checksum mismatch; remove .cache/presets/cream.tar.gz and retry.');
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', source]);
  writeFileSync(join(source, '.source-revision'), revision);
}
// Converted assets are reusable only with the exact source/compiler schema version.
const conversionMarker = join(output, '.conversion-version');
if (!existsSync(conversionMarker) || readFileSync(conversionMarker, 'utf8') !== version) {
  rmSync(join(output, 'cream'), { recursive: true, force: true });
  mkdirSync(join(output, 'cream'), { recursive: true });
  writeFileSync(conversionMarker, version);
}
copyFileSync(join(source, 'LICENSE.md'), join(output, 'CREAM-LICENSE.md'));
const require = createRequire(import.meta.url);
const builtin: Record<string, unknown> = require('butterchurn-presets').getPresets();
const entries: Entry[] = Object.keys(builtin).sort().map((name) => {
  const id = `builtin/${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
  writeFileSync(join(output, `${id}.json`), JSON.stringify(builtin[name]));
  return { id, name, collection: 'Butterchurn favorites', category: 'Favorites' };
});
const files = walk(source).filter((path) => path.toLowerCase().endsWith('.milk')).sort();
const failures: Failure[] = [];
let next = 0, finished = 0, converted = 0;
console.log(`Preparing ${files.length} Milkdrop presets. Conversion runs only during preparation, never in the app.`);
async function processFiles() {
  let worker: Worker | undefined;
  function spawnWorker() {
    const created = new Worker(new URL('./preset-worker.ts', import.meta.url), { stdout: true, stderr: true });
    created.stdout?.resume(); created.stderr?.resume();
    return created;
  }
  while (next < files.length) {
    const file = files[next++];
    const path = relative(source, file).split('\\').join('/');
    const id = `cream/${createHash('sha256').update(path).digest('hex').slice(0, 24)}`;
    const destination = join(output, `${id}.json`);
    let result: { ok: boolean; reason?: string } = { ok: true };
    if (!existsSync(destination)) {
      worker ??= spawnWorker();
      const active = worker;
      result = await new Promise((resolveResult) => {
        const finish = (value: { ok: boolean; reason?: string }) => { clearTimeout(timer); active.removeAllListeners('message'); active.removeAllListeners('error'); active.removeAllListeners('exit'); resolveResult(value); };
        const timer = setTimeout(() => { void active.terminate(); worker = undefined; finish({ ok: false, reason: 'Conversion exceeded 10 second limit' }); }, 10_000);
        active.once('message', finish);
        active.once('error', (error) => { worker = undefined; finish({ ok: false, reason: error.message }); });
        active.once('exit', (code) => { worker = undefined; finish({ ok: false, reason: `Converter exited (${code})` }); });
        active.postMessage({ source: file, destination });
      });
    }
    if (result.ok) {
      converted++;
      entries.push({ id, name: path.split('/').at(-1)!.replace(/\.milk$/i, ''), collection: 'Cream of the Crop', category: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Uncategorized' });
    } else failures.push({ path, reason: (result.reason || 'Unknown conversion failure').slice(0, 500) });
    finished++;
    if (finished % 250 === 0 || finished === files.length) console.log(`Presets ${finished}/${files.length}: ${converted} converted, ${failures.length} skipped`);
  }
  await worker?.terminate();
}
// Bounded build-time concurrency; the live app never starts these workers.
const workerCount = Math.max(1, Math.min(8, Number.parseInt(process.env.PRESET_IMPORT_WORKERS || '4', 10) || 4));
await Promise.all(Array.from({ length: workerCount }, () => processFiles()));
entries.sort((a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name));
const catalogue = { version, sourceRevision: revision, converted, skipped: failures.length, entries };
atomicJson(generated, catalogue);
atomicJson(join(output, 'import-report.json'), { version, source: 'https://github.com/projectM-visualizer/presets-cream-of-the-crop', sourceRevision: revision, compiler: 'milkdrop-preset-converter@0.1.2', total: files.length, converted, skipped: failures.length, failures, compatibility: 'Converted syntax only; WebGL shader behavior and third-party textures are not guaranteed. Original preset authors retain their rights. See CREAM-LICENSE.md.' });
atomicJson(manifestPath, catalogue);
console.log(`Ready: ${converted} Cream of the Crop presets + ${Object.keys(builtin).length} favorites. ${failures.length} skipped; details in public/presets/import-report.json.`);
