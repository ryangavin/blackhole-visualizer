import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
const require = createRequire(import.meta.url);
const converter = require('milkdrop-preset-converter');

parentPort!.on('message', async ({ source, destination }: { source: string; destination: string }) => {
  try {
    const preset = await converter.convertPreset(readFileSync(source, 'utf8'));
    if (!preset?.baseVals || !Array.isArray(preset.shapes) || !Array.isArray(preset.waves)) throw new Error('Incomplete converted preset');
    // Syntax validation only: actual WebGL shader compatibility is checked on load.
    for (const item of [preset, ...preset.shapes, ...preset.waves]) {
      for (const key of ['init_eqs_str', 'frame_eqs_str', 'pixel_eqs_str', 'point_eqs_str']) {
        if (item[key]) new Function('a', `${item[key]}; return a;`);
      }
    }
    writeFileSync(`${destination}.tmp`, JSON.stringify(preset));
    renameSync(`${destination}.tmp`, destination);
    parentPort!.postMessage({ ok: true });
  } catch (error) {
    parentPort!.postMessage({ ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
});
