# BlackHole Visualizer

A macOS desktop visualizer: Butterchurn/MilkDrop presets in Tauri's WKWebView, driven by native BlackHole input. No Chrome, browser tab, audio playback, or background web server is needed for the release app.

## Run

```sh
cd /Users/ryan/Code/ryangavin/blackhole-visualizer
npm start
```

The launcher builds the release app if it is missing or source files changed, then opens **BlackHole Visualizer.app**. Subsequent launches reuse the build. Close the window or quit the app when finished.

Dependencies are already installed for this checkout. A fresh checkout needs Node 22.18+ (or a newer release with TypeScript stripping), npm, Rust, and Xcode command-line tools, followed by `npm install`.

## Feed it audio

1. Send your music app or DAW's output to **BlackHole 2ch**. For system-wide sound, choose BlackHole in macOS Sound output settings.
2. In the visualizer select BlackHole, channels **1 / 2**, and click **Start**. Allow macOS microphone access if prompted; this permission also covers virtual audio inputs.
3. Play music. Input meters show the captured signal. Choose a preset and fullscreen when ready.

To hear the music while visualizing it, use a **Multi-Output Device** in macOS Audio MIDI Setup containing BlackHole and your normal output, or route a separate send to BlackHole from your DAW. The visualizer does not monitor audio to your speakers. Keep the visualizer input on BlackHole itself, even when the music output is a Multi-Output Device.

BlackHole 2ch was detected on this Mac at 48 kHz during setup. The app queries actual devices each launch; it does not assume a fixed device ID. Install information: <https://github.com/ExistentialAudio/BlackHole>.

## Performance

Audio capture uses Core Audio through Rust/CPAL. A bounded latest-sample history supplies 1024 samples per channel to Butterchurn; audio does not accumulate in an event queue. WebKit renders locally using WebGL 2. The capture callback does not run JavaScript or send audio to an output device.

Use **Render & display** to choose adaptive window scale (25–100%), a fixed HD/Full HD/QHD/4K buffer, or custom dimensions. The actual buffer size is displayed. Fixed sizes default to **Contain**, preserving the entire image with black letterboxing; Cover crops edges and Stretch changes proportions. Dimensions are constrained by GPU limits and a 4K pixel budget. Adaptive Retina density is capped at 2×. Mesh detail and FXAA provide additional quality controls. Frame targets are 15, 24, 30, or 60 FPS. High resolutions and some presets demand substantially more GPU work. The frame timing display describes the renderer's observed behavior, not a calibrated audio-to-photon latency measurement. Tauri uses the macOS WebKit runtime and its helper processes; this is one application, not one OS process.

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

## Troubleshooting

- **No BlackHole:** install the BlackHole driver, restart if its installer requires it, then refresh devices.
- **Meters stay silent:** check that the source app is actually playing to BlackHole and that the selected channels carry audio. Permission is under System Settings → Privacy & Security → Microphone.
- **Device disconnected or capture error:** stop, refresh devices, select BlackHole again, and start with default sample rate and buffer size.
- **Low frame rate:** reduce render scale, choose 30 FPS, or try a less demanding preset.
- **Black visualizer / WebGL error:** this requires working WebGL 2 in the system WebKit; the UI reports initialization errors.

No automated tests were added or run, by request. Compile/build checks do not establish live audio quality or preset compatibility; Ryan is the first hands-on tester.

## Credits

[Butterchurn](https://github.com/jberg/butterchurn), [Butterchurn presets](https://github.com/jberg/butterchurn-presets), [Tauri](https://tauri.app), [CPAL](https://github.com/RustAudio/cpal), and [BlackHole](https://github.com/ExistentialAudio/BlackHole). Dependency licenses remain in their packages. The app uses an existing BlackHole installation and does not bundle the driver.
