# Preset collections

The app ships the 100 original Butterchurn favorites and prepares the requested
[Cream of the Crop collection](https://github.com/projectM-visualizer/presets-cream-of-the-crop)
locally. Source filenames, author names embedded in those filenames, and the full
upstream category paths are retained in the searchable catalogue.

## Reproducible local preparation

`npm run presets:prepare` fetches projectM's collection at immutable revision
`0180df21f5e0bd39b9060cc5de420ed2f1f9e509` and converts its 9,795 `.milk` files to
Butterchurn JSON with Jordan Berg's `milkdrop-preset-converter@0.1.2` (pinned in
`package-lock.json`). This is the portable JavaScript/Emscripten converter; the
legacy native Node converter is not required. Run `npm ci` before first preparation.

Preparation runs automatically before `web:dev` and `web:build`, including Tauri
builds launched by `npm start`. The first build needs internet access to download
the upstream collection. Converted files are reused on later builds and launches.
The installed app includes those files and works offline. Conversion never runs
in the visualization window or live audio process.

Four isolated worker threads (configurable with `PRESET_IMPORT_WORKERS=1..8`)
convert the collection with a three-second limit per
preset. Invalid equations, converter failures, and timeouts are omitted from the
selectable catalogue and listed in `public/presets/import-report.json`. Successful
conversion validates JavaScript equation syntax, not rendered appearance or GPU
shader compatibility. Some Milkdrop shaders, custom textures, and newer projectM
features may not work in Butterchurn 2.6.7. If a preset fails on load, choose another;
conversion counts are not a promise that every preset renders correctly.

The interface loads only the selected preset's JSON and keeps at most eight preset
payloads in memory. The metadata catalogue contains names and paths, not equations
or shaders. Butterchurn itself compiles the selected preset's equations/shaders when
switching to it.

Generated preset assets (`public/presets/`), source download/cache (`.cache/`), and
catalogue (`src/generated/preset-catalogue.json`) are deliberately ignored in Git.
To force a clean reimport, remove those three generated paths and run preparation
again. Ordinary starts do not redownload or reconvert the pack.

## Rights and attribution

Preset authors retain their copyrights. projectM's upstream license text says it
*assumes* the presets are public domain based on historical distribution; it is
not an explicit public-domain dedication by every author. We preserve that text
verbatim in [CREAM-OF-THE-CROP-LICENSE.md](CREAM-OF-THE-CROP-LICENSE.md) and in the
locally generated app assets. This repository does not republish the collection's
preset files or claim to license those works under the application's license.
Contact projectM as directed in the upstream text for author removal requests.

Butterchurn favorites come from `butterchurn-presets@2.4.7`; the compiler and
Butterchurn packages carry their respective upstream MIT licenses. Original
preset authors remain credited in the selector's names.
