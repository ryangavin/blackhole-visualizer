import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'public/presets/builtin');
const generated = join(root, 'src/generated/preset-catalogue.json');
mkdirSync(output, { recursive: true });
mkdirSync(dirname(generated), { recursive: true });
const require = createRequire(import.meta.url);
const presets: Record<string, unknown> = require('butterchurn-presets').getPresets();
const entries = Object.keys(presets).sort().map((name) => {
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 24);
  writeFileSync(join(output, `${hash}.json`), JSON.stringify(presets[name]));
  return { id: `builtin/${hash}`, name, collection: 'Butterchurn favorites', category: 'Favorites' };
});
writeFileSync(generated, JSON.stringify({ entries }));
console.log(`Ready: ${entries.length} Butterchurn favorites.`);
