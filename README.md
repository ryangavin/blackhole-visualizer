# BlackHole Visualizer

A macOS desktop visualizer: Butterchurn/MilkDrop presets in Tauri's WKWebView, driven by a native Core Audio interface or BlackHole loopback input. Pick any two input channels as left and right. No Chrome, browser tab, audio playback, or background web server is needed for the release app.

## Run

```sh
git clone https://github.com/ryangavin/blackhole-visualizer.git
cd blackhole-visualizer
npm install
npm start
```

The launcher builds the release app if it is missing or source files changed, then opens **BlackHole Visualizer.app**. Subsequent launches reuse the build. Close the window or quit the app when finished.

A fresh checkout needs Node 22.18+ (or a newer release with TypeScript stripping), npm, Rust, and Xcode command-line tools. Internet access is needed to install dependencies; preset preparation uses the installed Butterchurn favorites. Playback uses local assets afterward.

## Feed it audio

1. Connect a class-compliant audio interface, or send your music app/DAW output to **BlackHole** for loopback capture.
2. Select the input device in the visualizer. Select any input for **Left** and **Right**: 1/2, 7/8, or two nonadjacent channels all work when exposed by the device. The UI numbers channels starting at 1.
3. Click **Start listening** and allow macOS microphone access if prompted. This permission also covers interfaces and virtual inputs. Play music and watch the input meters.

To hear the music while visualizing it, use a **Multi-Output Device** in macOS Audio MIDI Setup containing BlackHole and your normal output, or route a separate send to BlackHole from your DAW. The visualizer does not monitor audio to your speakers. Keep the visualizer input on BlackHole itself, even when the music output is a Multi-Output Device.

The app queries actual devices each launch; it does not assume a fixed device ID or input pair. Stop listening before changing inputs. BlackHole installation information: <https://github.com/ExistentialAudio/BlackHole>.

## Preset collections

The preset browser includes 100 original Butterchurn favorites. Search, shuffle, and navigation work across these presets.

Only metadata is loaded at startup; each preset's equations and shaders load when selected, with a bounded cache. The packaged app works offline. No additional preset packs are downloaded.

## Performance

Audio capture uses Core Audio through Rust/CPAL. A bounded latest-sample history supplies 1024 samples per channel to Butterchurn; audio does not accumulate in an event queue. WebKit renders locally using WebGL 2. The capture callback does not run JavaScript or send audio to an output device.

For an audio rig, use the **Live rig / lower CPU** profile: 30 FPS, a 24×18 equation mesh, and immediate preset changes. This leaves your render resolution and FXAA choice intact. MilkDrop's mesh equations run on the CPU independently of the GPU pixel resolution; lowering mesh detail and frame rate reduces that work. Transitions run two presets at once, so disabling them also avoids that temporary load. Individual presets still vary in CPU cost.

PCM snapshots follow rendered frames instead of a separate fixed-rate polling loop. Paused or hidden visuals stop requesting waveform data; the native input remains open so resuming does not interrupt or reconfigure your audio device. Control-panel status updates are lightweight and do not require PCM transfers. Frame timing shown in the app is CPU time spent submitting a render, not total process CPU or GPU time.

Use **Render & display** to choose adaptive window scale (25–100%), a fixed HD/Full HD/QHD/4K buffer, or custom dimensions. The actual WebGL drawing buffer size is displayed. Both the canvas output and Butterchurn textures use this resolution; allocation failures are reported rather than presenting a requested size as actual. Fixed sizes default to **Contain**, preserving the entire image with black letterboxing; Cover crops edges and Stretch changes proportions. Dimensions are constrained by GPU limits and a 4K pixel budget. Adaptive Retina density is capped at 2×. Mesh detail and FXAA provide additional quality controls. Frame targets are 15, 24, 30, or 60 FPS. High resolutions and some presets demand substantially more GPU work. The frame timing display describes the renderer's observed behavior, not a calibrated audio-to-photon latency measurement. Tauri uses the macOS WebKit runtime and its helper processes; this is one application, not one OS process.

Sample-rate and buffer choices are device capabilities, not promises of exclusive access. Changing those settings may affect other applications using BlackHole. Default settings preserve the device's current/default configuration where supported.

## Motion and presentation

**Motion → Animation speed** runs the preset clock at 0.1–2×, starting at 0.5× for existing preferences without this setting. It slows time-based movement; frame-driven feedback and beat reactions vary by preset. Lowering the frame target can also calm frame-driven motion. This does not slow or change audio playback.

Preset transition duration is approximately wall-clock seconds at the speed selected when a transition starts; changing speed during a transition changes its remaining duration. Auto drift intervals always use real seconds. Pausing or hiding the app does not accumulate a catch-up jump.

Press **H** for a completely clean presentation: only the visualization and any intentional black letterbox remain. Controls, shading, tooltips, and cursor disappear, and hidden controls cannot receive keyboard focus. There is no hover reveal or floating button. **H** restores controls; **F** toggles fullscreen even in clean mode. Shortcuts do not interrupt text/numeric entry. Arrow keys change presets and Space pauses visuals when not interacting with a form control.

## Development

```sh
npm run dev    # unified Tauri + Vite development launcher
npm run build  # compile frontend and release macOS app
```

The development launcher owns Vite on port 1420. Do not run another Vite instance on that port while it is running.

App bundle: `src-tauri/target/release/bundle/macos/BlackHole Visualizer.app`.

After building, enumerate inputs without opening a window or starting capture:

```sh
src-tauri/target/release/blackhole-visualizer --list-inputs
```

## Troubleshooting

- **No input device:** connect your interface, or install BlackHole for loopback use, then refresh devices.
- **Meters stay silent:** check the selected interface channels or BlackHole routing. Permission is under System Settings → Privacy & Security → Microphone.
- **Device disconnected or capture error:** stop, refresh devices, select the input again, and start with default sample rate and buffer size.
- **High CPU:** choose the Live rig profile, reduce mesh detail/frame rate, disable transitions, or choose a less demanding preset. Reducing render size primarily helps GPU work.
- **Black visualizer / WebGL error:** this requires working WebGL 2 in the system WebKit; the UI reports initialization errors.

Validation uses compile/build checks and targeted diagnostic probes. Preset compatibility and live audio behavior can vary by device and system WebKit version.

## Credits

[Butterchurn](https://github.com/jberg/butterchurn), [Butterchurn presets](https://github.com/jberg/butterchurn-presets), [Tauri](https://tauri.app), [CPAL](https://github.com/RustAudio/cpal), and [BlackHole](https://github.com/ExistentialAudio/BlackHole). Dependency licenses remain in their packages. The app uses an existing BlackHole installation and does not bundle the driver.
