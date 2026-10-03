import butterchurn from 'butterchurn';
import presetPack from 'butterchurn-presets';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './style.css';

type AudioDevice = { id: string; name: string; channels: number; sampleRates: number[]; defaultSampleRate: number; bufferMin: number | null; bufferMax: number | null };
type AudioStatus = { running: boolean; deviceName: string | null; sampleRate: number; channels: number; bufferSize: number | null; leftChannel: number; rightChannel: number; peakLeft: number; peakRight: number; framesReceived: number; lastFrameAgeMs: number | null; error: string | null };
type Preferences = { device: string; left: number; right: number; rate: number; buffer: number; gain: number; resolution: number; fps: number; preset: string; auto: boolean; interval: number; speed: number; transition: number; renderMode: string; customWidth: number; customHeight: number; fit: string; mesh: string; fxaa: boolean };
const defaults: Preferences = { device: '', left: 0, right: 1, rate: 0, buffer: 0, gain: 1, resolution: .75, fps: 60, preset: '', auto: false, interval: 30, speed: .5, transition: 4, renderMode: 'adaptive', customWidth: 1920, customHeight: 1080, fit: 'contain', mesh: '48x36', fxaa: true };
let preferences = { ...defaults };
try { preferences = { ...defaults, ...JSON.parse(localStorage.getItem('blackhole.preferences') || '{}') }; } catch { /* Fresh preferences if storage is unavailable. */ }
const bounded = (value: number, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
preferences.speed = bounded(preferences.speed, .5, .1, 2);
preferences.transition = bounded(preferences.transition, 4, 0, 15);
preferences.fps = [15, 24, 30, 60].includes(preferences.fps) ? preferences.fps : 60;
preferences.resolution = [.25, .5, .75, 1].includes(preferences.resolution) ? preferences.resolution : .75;
preferences.renderMode = ['adaptive', '1280x720', '1920x1080', '2560x1440', '3840x2160', 'custom'].includes(preferences.renderMode) ? preferences.renderMode : 'adaptive';
preferences.fit = ['contain', 'cover', 'stretch'].includes(preferences.fit) ? preferences.fit : 'contain';
preferences.mesh = ['24x18', '48x36', '96x72'].includes(preferences.mesh) ? preferences.mesh : '48x36';
preferences.customWidth = bounded(preferences.customWidth, 1920, 64, 8192);
preferences.customHeight = bounded(preferences.customHeight, 1080, 64, 8192);
const desktop = isTauri();
const presets = presetPack.getPresets();
const presetNames = Object.keys(presets).sort((a, b) => a.localeCompare(b));
let devices: AudioDevice[] = [];
let capturing = false;
let busy = false;
let paused = false;
let controlsHidden = false;
let visualizer: ReturnType<typeof butterchurn.createVisualizer> | null = null;
let currentPreset = presetNames.includes(preferences.preset) ? preferences.preset : presetNames.find(name => /flexi.*martin|martin.*flexi/i.test(name)) || presetNames[0];
let presetChangedAt = performance.now();
let status: AudioStatus | null = null;
const audioLevels = { timeByteArray: new Uint8Array(1024).fill(128), timeByteArrayL: new Uint8Array(1024).fill(128), timeByteArrayR: new Uint8Array(1024).fill(128) };
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <canvas id="visualizer" aria-label="Music visualization"></canvas>
  <div class="vignette"></div>
  <header class="topbar chrome">
    <div class="brand"><span class="brand-mark">◉</span><div>BLACKHOLE<span class="brand-sub">AUDIO / VISUAL</span></div></div>
    <div class="top-actions"><span id="live-badge" class="badge"><i></i>STANDBY</span><button id="fullscreen" class="icon-button" title="Fullscreen · F" aria-label="Toggle fullscreen">⛶</button><button id="hide" class="icon-button" title="Hide controls · H" aria-label="Hide controls">−</button></div>
  </header>
  <main class="chrome">
    <section class="panel" aria-label="Visualizer controls">
      <div class="panel-heading"><span class="eyebrow">LIVE SIGNAL</span><span class="tiny">CORE AUDIO → WEBGL</span></div>
      <h1>Sound, made visible.</h1>
      <p class="intro">Your music. A different dimension.</p>
      <div id="message" class="message" role="status">Finding BlackHole inputs…</div>
      <div class="label-row"><label for="device">INPUT SOURCE</label><button id="refresh" class="text-button">↻ Refresh</button></div>
      <select id="device" aria-label="BlackHole input device"></select>
      <div class="channel-grid"><div><label for="left">LEFT CHANNEL</label><select id="left"></select></div><div><label for="right">RIGHT CHANNEL</label><select id="right"></select></div></div>
      <div class="meters" aria-label="Input levels"><span>L</span><div class="meter"><div id="meter-left"></div></div><span>R</span><div class="meter"><div id="meter-right"></div></div></div>
      <button id="capture" class="primary" disabled><span id="capture-icon">▶</span><span id="capture-label">Start listening</span></button>
      <div class="slider-label"><label for="gain">VISUAL SENSITIVITY</label><output id="gain-value">1.00×</output></div><input id="gain" type="range" min="0.1" max="4" step="0.05" />
      <details id="motion" open><summary>Motion<span>↝</span></summary><div class="details-content">
        <div class="slider-label"><label for="speed">ANIMATION SPEED</label><output id="speed-value"></output></div><input id="speed" type="range" min="0.1" max="2" step="0.05" />
        <div class="slider-label"><label for="transition">PRESET TRANSITION</label><output id="transition-value"></output></div><input id="transition" type="range" min="0" max="15" step="0.5" />
        <p class="small-note">Slows time-based movement. Frame-driven feedback varies by preset; a lower frame target can tame it. Auto drift uses real seconds.</p>
      </div></details>
      <details id="render-settings"><summary>Render & display<span>＋</span></summary><div class="details-content">
        <label for="render-mode">RENDER BUFFER</label><select id="render-mode"><option value="adaptive">Adaptive · follow window</option><option value="1280x720">1280 × 720 · HD</option><option value="1920x1080">1920 × 1080 · Full HD</option><option value="2560x1440">2560 × 1440 · QHD</option><option value="3840x2160">3840 × 2160 · 4K</option><option value="custom">Custom dimensions</option></select>
        <div id="custom-size" class="custom-size" hidden><div class="channel-grid"><div><label for="custom-width">WIDTH / PX</label><input id="custom-width" type="number" min="64" max="8192" step="1" /></div><div><label for="custom-height">HEIGHT / PX</label><input id="custom-height" type="number" min="64" max="8192" step="1" /></div></div><button id="apply-size" class="secondary">Apply dimensions</button></div>
        <div class="channel-grid"><div><label for="resolution">WINDOW SCALE</label><select id="resolution"><option value="0.25">25% · minimal</option><option value="0.5">50% · lighter</option><option value="0.75">75% · balanced</option><option value="1">100% · sharp</option></select></div><div><label for="fit">DISPLAY FIT</label><select id="fit"><option value="contain">Contain · full frame</option><option value="cover">Cover · crop edges</option><option value="stretch">Stretch · fill screen</option></select></div></div>
        <div class="buffer-readout"><span>ACTUAL BUFFER</span><output id="buffer-size">—</output></div><p id="render-message" class="small-note" role="status">Fixed buffers keep their aspect ratio by default.</p>
        <div class="channel-grid"><div><label for="mesh">MESH DETAIL</label><select id="mesh"><option value="24x18">24 × 18 · lighter</option><option value="48x36">48 × 36 · balanced</option><option value="96x72">96 × 72 · detailed</option></select></div><div><label for="fps">FRAME TARGET</label><select id="fps"><option value="15">15 fps</option><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></div></div>
        <label class="auto-label fxaa"><input id="fxaa" type="checkbox" />Smooth edges / FXAA</label><div class="telemetry"><span id="performance">— fps · — ms</span></div>
      </div></details>
      <details id="settings"><summary>Audio settings<span>＋</span></summary><div class="details-content">
        <div class="channel-grid"><div><label for="rate">SAMPLE RATE</label><select id="rate"></select></div><div><label for="buffer">BUFFER FRAMES</label><select id="buffer"></select></div></div>
        <p class="small-note">Device settings apply when listening starts. System default respects your existing routing.</p>
<div class="telemetry"><span id="audio-info">No active input</span></div>
      </div></details>
      <details class="routing"><summary>How to route your sound<span>↗</span></summary><div class="details-content"><ol><li>In <strong>Audio MIDI Setup</strong>, create a Multi-Output Device with your speakers or interface and BlackHole. Enable drift correction for the secondary device.</li><li>Choose that Multi-Output Device as your Mac’s sound output, or send your DAW directly to BlackHole.</li><li>Select the matching BlackHole channels here and press <strong>Start listening</strong>.</li></ol><p class="small-note">This app only listens. Your existing audio routing handles playback. macOS may ask for microphone access.</p></div></details>
    </section>
  </main>
  <footer class="preset-bar chrome">
    <div class="preset-caption"><span class="eyebrow">MILKDROP PRESET</span><span id="preset-count" class="tiny"></span></div>
    <div class="preset-controls"><button id="previous" class="icon-button" title="Previous preset · ←" aria-label="Previous preset">‹</button><div class="preset-picker"><input id="preset-search" type="search" placeholder="Find a preset…" aria-label="Search presets" /><select id="preset" aria-label="Visualization preset"></select></div><button id="next" class="icon-button" title="Next preset · →" aria-label="Next preset">›</button><button id="random" class="secondary" title="Random preset">Shuffle ↗</button><button id="pause" class="icon-button" title="Pause visuals · Space" aria-label="Pause visuals">Ⅱ</button></div>
    <div class="footer-row"><label class="auto-label"><input id="auto" type="checkbox" />Auto drift</label><select id="interval" aria-label="Seconds between presets"><option value="15">15 sec</option><option value="30">30 sec</option><option value="60">60 sec</option><option value="120">2 min</option></select><span class="shortcuts">F fullscreen <b>·</b> H hide <b>·</b> ← → presets</span></div>
  </footer>
`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
const save = () => { try { localStorage.setItem('blackhole.preferences', JSON.stringify(preferences)); } catch { /* Rendering works without storage. */ } };
const setMessage = (message: string, kind = '') => { el('message').textContent = message; el('message').className = `message ${kind}`; };
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);
const option = (text: string, value: string | number) => new Option(text, String(value));
let visualizerSampleRate = 0;
function syncVisualizerSampleRate(sampleRate: number) {
  if (!visualizer || sampleRate <= 0 || sampleRate === visualizerSampleRate) return;
  // Butterchurn 2.6.7 assumes 44.1 kHz without an AudioContext. Native capture
  // must update its FFT band boundaries to match the actual Core Audio rate.
  const band = (hz: number) => Math.max(0, Math.min(511, Math.round(hz / (sampleRate / 1024)) - 1));
  visualizer.renderer.audioLevels.starts = [band(20), band(320), band(2800)];
  visualizer.renderer.audioLevels.stops = [band(320), band(2800), band(11025)];
  visualizerSampleRate = sampleRate;
}
function updateDeviceOptions() {
  const device = devices.find(d => d.id === select('device').value);
  for (const side of ['left', 'right'] as const) {
    const field = select(side); field.replaceChildren();
    for (let i = 0; i < (device?.channels || 0); i++) field.add(option(`Input ${i + 1}`, i));
    preferences[side] = Math.min(Math.max(0, preferences[side]), Math.max(0, (device?.channels || 1) - 1));
    field.value = String(preferences[side]);
  }
  const rate = select('rate'); rate.replaceChildren(option(`System default${device?.defaultSampleRate ? ` · ${device.defaultSampleRate / 1000} kHz` : ''}`, 0));
  for (const value of device?.sampleRates || []) rate.add(option(`${value / 1000} kHz`, value));
  rate.value = String(preferences.rate); if (rate.selectedIndex < 0) { rate.value = '0'; preferences.rate = 0; }
  const buffer = select('buffer'); buffer.replaceChildren(option('System default', 0));
  if (device?.bufferMin != null && device.bufferMax != null) {
    const sizes = [...new Set([device.bufferMin, ...[32, 64, 128, 256, 512, 1024, 2048].filter(n => n >= device.bufferMin! && n <= device.bufferMax!), device.bufferMax])].sort((a, b) => a - b);
    for (const size of sizes) buffer.add(option(String(size), size));
  }
  buffer.value = String(preferences.buffer); if (buffer.selectedIndex < 0) { buffer.value = '0'; preferences.buffer = 0; }
  el<HTMLButtonElement>('capture').disabled = !device || busy || !desktop;
}
async function refreshDevices() {
  if (!desktop) { setMessage('Open the desktop app to listen to BlackHole. This browser preview shows visuals only.'); select('device').replaceChildren(option('Desktop app required', '')); updateDeviceOptions(); return; }
  el<HTMLButtonElement>('refresh').disabled = true;
  try {
    devices = (await invoke<AudioDevice[]>('list_audio_devices')).filter(d => /blackhole/i.test(d.name) && d.channels > 0);
    select('device').replaceChildren(...devices.map(d => option(`${d.name} · ${d.channels} inputs`, d.id)));
    if (devices.some(d => d.id === preferences.device)) select('device').value = preferences.device;
    preferences.device = select('device').value;
    if (!devices.length) { select('device').add(option('No BlackHole device found', '')); setMessage('BlackHole isn’t available. Install BlackHole, then refresh inputs. Open the routing guide below for setup.', 'warning'); }
    else if (!capturing) setMessage('Ready when you are. Route audio to BlackHole, then start listening.');
    updateDeviceOptions(); save();
  } catch (error) { setMessage(`Could not list inputs: ${describeError(error)}`, 'error'); }
  finally { el<HTMLButtonElement>('refresh').disabled = false; }
}
function captureUI() {
  el('capture-label').textContent = capturing ? 'Stop listening' : 'Start listening'; el('capture-icon').textContent = capturing ? '■' : '▶';
  el('capture').classList.toggle('active', capturing);
  el('live-badge').innerHTML = `<i></i>${capturing ? 'LISTENING' : 'STANDBY'}`;
  el('live-badge').classList.toggle('live', capturing);
  for (const id of ['device', 'left', 'right', 'rate', 'buffer']) select(id).disabled = capturing || busy;
  el<HTMLButtonElement>('capture').disabled = busy || !devices.length;
  el<HTMLButtonElement>('refresh').disabled = capturing || busy;
}
async function toggleCapture() {
  if (busy || !desktop) return;
  busy = true; captureUI();
  try {
    if (capturing) { await invoke('stop_audio'); capturing = false; audioLevels.timeByteArray.fill(128); audioLevels.timeByteArrayL.fill(128); audioLevels.timeByteArrayR.fill(128); el('audio-info').textContent = 'No active input'; setMessage('Input stopped. Ready for your next session.'); }
    else { setMessage('Opening BlackHole…'); status = await invoke<AudioStatus>('start_audio', { deviceId: select('device').value, leftChannel: Number(select('left').value), rightChannel: Number(select('right').value), sampleRate: Number(select('rate').value), bufferSize: Number(select('buffer').value) }); capturing = status.running; syncVisualizerSampleRate(status.sampleRate); if (!capturing) throw new Error(status.error || 'The audio input did not start.'); setMessage('Listening. Play audio through BlackHole to bring the visuals to life.'); }
  } catch (error) { setMessage(describeError(error), 'error'); }
  finally { busy = false; captureUI(); }
}
function fillPresets(filter = '') {
  const names = presetNames.filter(name => name.toLowerCase().includes(filter.toLowerCase()));
  select('preset').replaceChildren(...names.map(name => option(name, name)));
  if (names.includes(currentPreset)) select('preset').value = currentPreset;
  el('preset-count').textContent = `${names.length} / ${presetNames.length}`;
}
function loadPreset(name: string, blend = preferences.transition) {
  if (!presets[name] || !visualizer) return;
  try { visualizer.loadPreset(presets[name], blend * preferences.speed); currentPreset = name; preferences.preset = name; presetChangedAt = performance.now(); if (el<HTMLInputElement>('preset-search').value) el<HTMLInputElement>('preset-search').value = ''; fillPresets(); save(); }
  catch (error) { setMessage(`This preset could not load: ${describeError(error)}. Try another preset.`, 'error'); }
}
function nextPreset(direction: number) { loadPreset(presetNames[(presetNames.indexOf(currentPreset) + direction + presetNames.length) % presetNames.length]); }
function randomPreset() { const offset = 1 + Math.floor(Math.random() * Math.max(1, presetNames.length - 1)); nextPreset(offset); }
function toggleControls() {
  controlsHidden = !controlsHidden;
  if (controlsHidden && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.body.classList.toggle('controls-hidden', controlsHidden);
  for (const chrome of document.querySelectorAll<HTMLElement>('.chrome')) { chrome.inert = controlsHidden; chrome.setAttribute('aria-hidden', String(controlsHidden)); }
}
function togglePause() { paused = !paused; lastVisualTime = 0; lastRender = 0; el('pause').textContent = paused ? '▶' : 'Ⅱ'; el('pause').setAttribute('aria-label', paused ? 'Resume visuals' : 'Pause visuals'); }
async function fullscreen() { try { if (desktop) { const win = getCurrentWindow(); await win.setFullscreen(!await win.isFullscreen()); } else if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (error) { setMessage(`Fullscreen unavailable: ${describeError(error)}`, 'error'); } }
let gl: WebGL2RenderingContext | null = null;
let bufferWidth = 0, bufferHeight = 0;
let appliedMesh = '', appliedFXAA: boolean | null = null;
function updateRenderUI() {
  const adaptive = preferences.renderMode === 'adaptive';
  select('resolution').disabled = !adaptive;
  select('fit').disabled = adaptive;
  el('custom-size').hidden = preferences.renderMode !== 'custom';
}
function displayCanvas() {
  const canvas = el<HTMLCanvasElement>('visualizer');
  if (!bufferWidth || !bufferHeight) return;
  let width = innerWidth, height = innerHeight;
  if (preferences.renderMode !== 'adaptive' && preferences.fit !== 'stretch') {
    const factor = preferences.fit === 'cover' ? Math.max(innerWidth / bufferWidth, innerHeight / bufferHeight) : Math.min(innerWidth / bufferWidth, innerHeight / bufferHeight);
    width = bufferWidth * factor; height = bufferHeight * factor;
  }
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  canvas.style.left = `${(innerWidth - width) / 2}px`; canvas.style.top = `${(innerHeight - height) / 2}px`;
}
function resize(): boolean {
  if (!visualizer || !gl) return false;
  let width: number, height: number;
  if (preferences.renderMode === 'adaptive') {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = innerWidth * ratio * preferences.resolution; height = innerHeight * ratio * preferences.resolution;
  } else if (preferences.renderMode === 'custom') { width = preferences.customWidth; height = preferences.customHeight; }
  else { [width, height] = preferences.renderMode.split('x').map(Number); }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) { el('render-message').textContent = 'Enter positive width and height values.'; return false; }
  // Butterchurn keeps several full-size GPU textures. Bound the working set to 4K pixels.
  const dimensionLimit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 8192);
  const factor = Math.min(1, dimensionLimit / width, dimensionLimit / height, Math.sqrt(3840 * 2160 / (width * height)));
  width = Math.max(1, Math.floor(width * factor)); height = Math.max(1, Math.floor(height * factor));
  const oldWidth = bufferWidth, oldHeight = bufferHeight;
  try {
    if (width !== bufferWidth || height !== bufferHeight || canvas.width !== width || canvas.height !== height || gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
      // Discard prior errors so resize diagnostics describe this allocation only.
      for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* drain */ }
      // Butterchurn resizes its textures, not the canvas's presentation buffer.
      // Set intrinsic dimensions first because setRendererSize rerenders immediately.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      visualizer.setRendererSize(width, height);
      const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error(`GPU allocation error ${error}; requested ${width} × ${height}, observed ${gl.drawingBufferWidth} × ${gl.drawingBufferHeight}`);
      if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) throw new Error(`Requested ${width} × ${height}, but WebGL allocated ${gl.drawingBufferWidth} × ${gl.drawingBufferHeight}`);
      bufferWidth = width; bufferHeight = height;
    }
    displayCanvas();
    el('buffer-size').textContent = `${gl.drawingBufferWidth.toLocaleString()} × ${gl.drawingBufferHeight.toLocaleString()}`;
    el('render-message').textContent = factor < 1 ? 'Size reduced to fit GPU limits and the 4K pixel budget.' : preferences.renderMode === 'adaptive' ? 'Follows the window. Retina density is capped at 2×.' : preferences.fit === 'stretch' ? 'Stretch fills the screen and changes the image proportions.' : preferences.fit === 'cover' ? 'Aspect preserved; edges may be cropped.' : 'Aspect preserved. Unused screen area stays black.';
    return true;
  } catch (error) {
    let recoveryError = '';
    if (oldWidth && oldHeight) {
      try {
        for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* drain original allocation errors */ }
        if (canvas.width !== oldWidth) canvas.width = oldWidth;
        if (canvas.height !== oldHeight) canvas.height = oldHeight;
        visualizer.setRendererSize(oldWidth, oldHeight);
        const restoreError = gl.getError();
        if (restoreError !== gl.NO_ERROR || gl.drawingBufferWidth !== oldWidth || gl.drawingBufferHeight !== oldHeight) throw new Error('The previous drawing buffer could not be restored');
        bufferWidth = oldWidth; bufferHeight = oldHeight; displayCanvas();
      } catch (restoreError) { recoveryError = ` ${describeError(restoreError)}.`; }
    }
    el('buffer-size').textContent = `${gl.drawingBufferWidth.toLocaleString()} × ${gl.drawingBufferHeight.toLocaleString()}`;
    el('render-message').textContent = `Could not resize: ${describeError(error)}.${recoveryError} Choose a smaller buffer.`;
    return false;
  }
}
function applyRenderPreference(change: () => void) {
  const before = { ...preferences }; change(); updateRenderUI();
  if (!resize()) { preferences = before; select('render-mode').value = preferences.renderMode; select('resolution').value = String(preferences.resolution); select('fit').value = preferences.fit; updateRenderUI(); displayCanvas(); }
  save();
}
function applyQuality() {
  if (!visualizer) return;
  try {
    if (appliedMesh !== preferences.mesh) { const [width, height] = preferences.mesh.split('x').map(Number); visualizer.setInternalMeshSize(width, height); appliedMesh = preferences.mesh; }
    if (appliedFXAA !== preferences.fxaa) { visualizer.setOutputAA(preferences.fxaa); appliedFXAA = preferences.fxaa; }
  } catch (error) { el('render-message').textContent = `Could not apply detail: ${describeError(error)}`; }
}
el('refresh').addEventListener('click', refreshDevices);
el('capture').addEventListener('click', toggleCapture);
select('device').addEventListener('change', () => { preferences.device = select('device').value; updateDeviceOptions(); save(); });
for (const id of ['left', 'right', 'rate', 'buffer', 'fps', 'interval'] as const) {
  if (['fps', 'interval'].includes(id)) select(id).value = String(preferences[id]);
  select(id).addEventListener('change', () => { preferences[id] = Number(select(id).value); if (id === 'fps' && ![15, 24, 30, 60].includes(preferences.fps)) preferences.fps = 60; save(); });
}
const gain = el<HTMLInputElement>('gain'); gain.value = String(preferences.gain);
const updateGain = () => { preferences.gain = Number(gain.value); el('gain-value').textContent = `${preferences.gain.toFixed(2)}×`; save(); }; gain.addEventListener('input', updateGain); updateGain();
el('previous').addEventListener('click', () => nextPreset(-1)); el('next').addEventListener('click', () => nextPreset(1)); el('random').addEventListener('click', randomPreset); el('pause').addEventListener('click', togglePause);
select('preset').addEventListener('change', () => loadPreset(select('preset').value)); el('preset-search').addEventListener('input', () => fillPresets(el<HTMLInputElement>('preset-search').value));
el<HTMLInputElement>('auto').checked = preferences.auto; el('auto').addEventListener('change', () => { preferences.auto = el<HTMLInputElement>('auto').checked; presetChangedAt = performance.now(); save(); });
el('hide').addEventListener('click', toggleControls); el('fullscreen').addEventListener('click', fullscreen);
for (const id of ['speed', 'transition'] as const) {
  const input = el<HTMLInputElement>(id); input.value = String(preferences[id]);
  const update = () => { preferences[id] = Number(input.value); el(`${id}-value`).textContent = id === 'speed' ? `${preferences[id].toFixed(2)}×` : `${preferences[id].toFixed(1)} sec`; save(); };
  input.addEventListener('input', update); update();
}
select('render-mode').value = preferences.renderMode; select('resolution').value = String(preferences.resolution); select('fit').value = preferences.fit; select('mesh').value = preferences.mesh;
el<HTMLInputElement>('custom-width').value = String(preferences.customWidth); el<HTMLInputElement>('custom-height').value = String(preferences.customHeight); el<HTMLInputElement>('fxaa').checked = preferences.fxaa;
select('render-mode').addEventListener('change', () => applyRenderPreference(() => { preferences.renderMode = select('render-mode').value; }));
select('resolution').addEventListener('change', () => applyRenderPreference(() => { preferences.resolution = Number(select('resolution').value); }));
select('fit').addEventListener('change', () => { preferences.fit = select('fit').value; displayCanvas(); save(); });
el('apply-size').addEventListener('click', () => {
  const width = Number(el<HTMLInputElement>('custom-width').value), height = Number(el<HTMLInputElement>('custom-height').value);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) { el('render-message').textContent = 'Enter dimensions of at least 64 pixels.'; return; }
  applyRenderPreference(() => { preferences.customWidth = Math.round(width); preferences.customHeight = Math.round(height); });
});
select('mesh').addEventListener('change', () => { preferences.mesh = select('mesh').value; applyQuality(); save(); });
el('fxaa').addEventListener('change', () => { preferences.fxaa = el<HTMLInputElement>('fxaa').checked; applyQuality(); save(); });
updateRenderUI();
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || target.closest('textarea, [contenteditable="true"], input:not([type="range"]):not([type="checkbox"])')) return;
  const key = event.key.toLowerCase();
  if (key === 'f') { event.preventDefault(); void fullscreen(); return; }
  if (key === 'h') { event.preventDefault(); toggleControls(); return; }
  if (target.matches('input, select, button')) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); nextPreset(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); nextPreset(1); }
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
});
let resizeRequest = 0;
window.addEventListener('resize', () => { displayCanvas(); window.clearTimeout(resizeRequest); resizeRequest = window.setTimeout(() => { resizeRequest = 0; resize(); }, 180); });
document.addEventListener('visibilitychange', () => { lastVisualTime = 0; lastRender = 0; });
const canvas = el<HTMLCanvasElement>('visualizer');
canvas.width = 64; canvas.height = 64;
try {
  gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) throw new Error('WebGL 2 is unavailable in this WebKit view. Update macOS and reopen the app.');
  visualizer = butterchurn.createVisualizer(null, canvas, { width: 64, height: 64, pixelRatio: 1, textureRatio: 1 }); bufferWidth = 64; bufferHeight = 64; resize(); applyQuality(); loadPreset(currentPreset, 0);
} catch (error) { setMessage(`Visualizer could not start: ${describeError(error)}`, 'error'); }
fillPresets();
if (visualizer) void refreshDevices();
let lastVisualTime = 0;
let lastRender = 0, measuredAt = performance.now(), measuredFrames = 0, measuredCPU = 0;
function render(now: number) {
  requestAnimationFrame(render);
  if (paused || !visualizer || document.hidden) return;
  const interval = 1000 / preferences.fps;
  if (now - lastRender < interval - .7) return;
  lastRender = now - ((now - lastRender) % interval);
  const wallDelta = lastVisualTime ? Math.min(.25, Math.max(.001, (now - lastVisualTime) / 1000)) : 1 / preferences.fps;
  lastVisualTime = now;
  try { const started = performance.now(); visualizer.render({ audioLevels, elapsedTime: wallDelta * preferences.speed }); measuredCPU += performance.now() - started; measuredFrames++; }
  catch (error) { paused = true; el('pause').textContent = '▶'; setMessage(`Rendering paused: ${describeError(error)}. Try another preset and resume.`, 'error'); }
  if (now - measuredAt >= 1000) { el('performance').textContent = `${Math.round(measuredFrames * 1000 / (now - measuredAt))} fps · ${(measuredCPU / Math.max(1, measuredFrames)).toFixed(1)} ms CPU`; measuredAt = now; measuredFrames = 0; measuredCPU = 0; }
  if (preferences.auto && now - presetChangedAt > preferences.interval * 1000) randomPreset();
}
requestAnimationFrame(render);
let lastStatusAt = 0;
async function pollAudio() {
  try {
    if (desktop && capturing) {
      const frame = await invoke<ArrayBuffer>('get_audio_frame');
      if (frame instanceof ArrayBuffer && frame.byteLength === 8192) {
        const samples = new Float32Array(frame); const sensitivity = preferences.gain;
        for (let i = 0; i < 1024; i++) { const left = Number.isFinite(samples[i]) ? samples[i] * sensitivity : 0; const right = Number.isFinite(samples[i + 1024]) ? samples[i + 1024] * sensitivity : 0; audioLevels.timeByteArrayL[i] = Math.max(0, Math.min(255, Math.round(128 + left * 127))); audioLevels.timeByteArrayR[i] = Math.max(0, Math.min(255, Math.round(128 + right * 127))); audioLevels.timeByteArray[i] = Math.max(0, Math.min(255, Math.round(128 + (left + right) * 63.5))); }
      }
      if (performance.now() - lastStatusAt > 500) {
        lastStatusAt = performance.now(); status = await invoke<AudioStatus>('get_audio_status'); syncVisualizerSampleRate(status.sampleRate);
        for (const side of ['left', 'right'] as const) { const peak = side === 'left' ? status.peakLeft : status.peakRight; const meter = el(`meter-${side}`); meter.style.transform = `scaleX(${Math.max(0, Math.min(1, peak > 0 ? (20 * Math.log10(peak) + 60) / 60 : 0))})`; meter.classList.toggle('clipping', peak >= .99); }
        el('audio-info').textContent = `${status.sampleRate / 1000} kHz${status.bufferSize ? ` · ${status.bufferSize} frames` : ''}`;
        if (status.error) setMessage(status.error, 'error');
        else if (status.lastFrameAgeMs == null || status.lastFrameAgeMs > 2000) setMessage('Waiting for audio frames. Check BlackHole routing and microphone permission.', 'warning');
        else if (status.peakLeft < .0001 && status.peakRight < .0001) setMessage('Connected, but the input is silent. Send your music to BlackHole.');
        else setMessage(`Receiving audio from ${status.deviceName || 'BlackHole'}.`, 'success');
        if (!status.running) { capturing = false; audioLevels.timeByteArray.fill(128); audioLevels.timeByteArrayL.fill(128); audioLevels.timeByteArrayR.fill(128); captureUI(); }
      }
    } else { el('meter-left').style.transform = 'scaleX(0)'; el('meter-right').style.transform = 'scaleX(0)'; }
  } catch (error) { setMessage(`Audio connection interrupted: ${describeError(error)}`, 'error'); capturing = false; captureUI(); }
  finally { window.setTimeout(pollAudio, capturing && !document.hidden ? (paused ? 50 : 16) : 250); }
}
void pollAudio();
