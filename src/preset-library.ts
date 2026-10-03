import catalogue from './generated/preset-catalogue.json';

export interface PresetEntry { id: string; name: string; collection: string; category: string }
const entries: PresetEntry[] = catalogue.entries;
const ids = new Set(entries.map((entry) => entry.id));
const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();
function clonePreset(data: unknown): unknown {
  // macOS 12.0's WebKit predates structuredClone; preset payloads are pure JSON.
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(data)
    : JSON.parse(JSON.stringify(data));
}

export function getPresetEntries(): PresetEntry[] { return entries; }
export function getCollectionSummary(): string {
  return `${entries.length.toLocaleString()} Butterchurn favorites`;
}
export async function loadPresetData(id: string): Promise<unknown> {
  if (!ids.has(id)) throw new Error('Unknown preset');
  if (cache.has(id)) {
    const data = cache.get(id);
    cache.delete(id); cache.set(id, data);
    return clonePreset(data);
  }
  let request = pending.get(id);
  if (!request) {
    request = fetch(`${import.meta.env.BASE_URL}presets/${id}.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Preset could not be loaded (${response.status})`);
      const data: unknown = await response.json();
      cache.set(id, data);
      while (cache.size > 8) cache.delete(cache.keys().next().value!);
      return data;
    }).finally(() => pending.delete(id));
    pending.set(id, request);
  }
  // Butterchurn mutates nested preset data while loading; cache stays pristine.
  return clonePreset(await request);
}
