#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

const HISTORY: usize = 1024;
// Audio callbacks never lock or allocate. Atomic sample slots permit bounded snapshots
// without blocking Core Audio when the renderer pauses or the UI is busy.
struct Capture {
    left: [AtomicU32; HISTORY],
    right: [AtomicU32; HISTORY],
    sequence: AtomicU64,
    frames: AtomicU64,
    last_ms: AtomicU64,
    peak_left: AtomicU32,
    peak_right: AtomicU32,
    failed: AtomicBool,
    epoch: Instant,
}
impl Capture {
    fn new() -> Self {
        Self {
            left: std::array::from_fn(|_| AtomicU32::new(0)),
            right: std::array::from_fn(|_| AtomicU32::new(0)),
            sequence: AtomicU64::new(0),
            frames: AtomicU64::new(0),
            last_ms: AtomicU64::new(0),
            peak_left: AtomicU32::new(0),
            peak_right: AtomicU32::new(0),
            failed: AtomicBool::new(false),
            epoch: Instant::now(),
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioStatus {
    running: bool,
    device_name: Option<String>,
    sample_rate: u32,
    channels: u16,
    buffer_size: Option<u32>,
    left_channel: usize,
    right_channel: usize,
    peak_left: f32,
    peak_right: f32,
    frames_received: u64,
    last_frame_age_ms: Option<u64>,
    error: Option<String>,
}
impl Default for AudioStatus {
    fn default() -> Self {
        Self {
            running: false,
            device_name: None,
            sample_rate: 0,
            channels: 0,
            buffer_size: None,
            left_channel: 0,
            right_channel: 1,
            peak_left: 0.0,
            peak_right: 0.0,
            frames_received: 0,
            last_frame_age_ms: None,
            error: None,
        }
    }
}
#[derive(Default)]
struct Engine {
    generation: u64,
    stream: Option<cpal::Stream>,
    capture: Option<Arc<Capture>>,
    status: AudioStatus,
}
struct AudioState(Arc<Mutex<Engine>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioDevice {
    id: String,
    name: String,
    channels: u16,
    sample_rates: Vec<u32>,
    default_sample_rate: u32,
    buffer_min: Option<u32>,
    buffer_max: Option<u32>,
}
fn blackhole_devices() -> Result<Vec<cpal::Device>, String> {
    Ok(cpal::default_host()
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter(|d| {
            d.description()
                .map(|v| v.name().to_lowercase().contains("blackhole"))
                .unwrap_or(false)
        })
        .collect())
}
#[tauri::command]
fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let mut result = Vec::new();
    for device in blackhole_devices()? {
        let default = device.default_input_config().map_err(|e| e.to_string())?;
        let ranges: Vec<_> = device
            .supported_input_configs()
            .map_err(|e| e.to_string())?
            .collect();
        let mut rates = vec![default.sample_rate()];
        for range in &ranges {
            rates.extend([range.min_sample_rate(), range.max_sample_rate()]);
            rates.extend(
                [
                    8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000,
                ]
                .into_iter()
                .filter(|r| *r >= range.min_sample_rate() && *r <= range.max_sample_rate()),
            );
        }
        rates.sort_unstable();
        rates.dedup();
        let (min, max) = match default.buffer_size() {
            cpal::SupportedBufferSize::Range { min, max } => (Some(*min), Some(*max)),
            _ => (None, None),
        };
        result.push(AudioDevice {
            id: device.id().map_err(|e| e.to_string())?.to_string(),
            name: device
                .description()
                .map_err(|e| e.to_string())?
                .name()
                .to_owned(),
            channels: default.channels(),
            sample_rates: rates,
            default_sample_rate: default.sample_rate(),
            buffer_min: min,
            buffer_max: max,
        });
    }
    Ok(result)
}
fn snapshot_status(engine: &Engine) -> AudioStatus {
    let mut status = engine.status.clone();
    if let Some(capture) = &engine.capture {
        status.frames_received = capture.frames.load(Ordering::Acquire);
        status.last_frame_age_ms = (status.frames_received > 0).then(|| {
            (capture.epoch.elapsed().as_millis() as u64)
                .saturating_sub(capture.last_ms.load(Ordering::Relaxed))
        });
        let fresh = status.last_frame_age_ms.is_some_and(|age| age < 500);
        status.peak_left = if fresh {
            f32::from_bits(capture.peak_left.load(Ordering::Relaxed))
        } else {
            0.0
        };
        status.peak_right = if fresh {
            f32::from_bits(capture.peak_right.load(Ordering::Relaxed))
        } else {
            0.0
        };
        if capture.failed.load(Ordering::Acquire) {
            status.running = false;
            status.error = Some(
                "Core Audio input stopped or disconnected. Refresh devices and start again.".into(),
            );
        }
    }
    status
}
#[tauri::command]
fn get_audio_status(state: tauri::State<AudioState>) -> Result<AudioStatus, String> {
    {
        let engine = state.0.lock().map_err(|e| e.to_string())?;
        Ok(snapshot_status(&engine))
    }
}
#[tauri::command]
fn stop_audio(state: tauri::State<AudioState>) -> Result<(), String> {
    let mut engine = state.0.lock().map_err(|e| e.to_string())?;
    engine.generation += 1;
    let stream = engine.stream.take();
    engine.capture = None;
    engine.status = AudioStatus::default();
    drop(engine);
    drop(stream);
    Ok(())
}
#[tauri::command]
async fn start_audio(
    device_id: String,
    left_channel: usize,
    right_channel: usize,
    sample_rate: u32,
    buffer_size: u32,
    state: tauri::State<'_, AudioState>,
) -> Result<AudioStatus, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_capture(
            device_id,
            left_channel,
            right_channel,
            sample_rate,
            buffer_size,
            shared,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
fn start_capture(
    device_id: String,
    left_channel: usize,
    right_channel: usize,
    sample_rate: u32,
    buffer_size: u32,
    shared: Arc<Mutex<Engine>>,
) -> Result<AudioStatus, String> {
    let mut engine = shared.lock().map_err(|e| e.to_string())?;
    engine.generation += 1;
    let generation = engine.generation;
    let old_stream = engine.stream.take();
    engine.capture = None;
    engine.status = AudioStatus::default();
    drop(engine);
    drop(old_stream);
    // Device startup may trigger a system microphone prompt; never hold the
    // UI state lock or the main thread while Core Audio initializes.
    let device = blackhole_devices()?
        .into_iter()
        .find(|d| {
            d.id()
                .map(|id| id.to_string() == device_id)
                .unwrap_or(false)
        })
        .ok_or("BlackHole device is unavailable. Refresh the device list.")?;
    let default = device.default_input_config().map_err(|e| e.to_string())?;
    let rate = if sample_rate == 0 {
        default.sample_rate()
    } else {
        sample_rate
    };
    let supported = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .find(|c| {
            c.sample_format() == cpal::SampleFormat::F32
                && c.channels() as usize > left_channel.max(right_channel)
                && rate >= c.min_sample_rate()
                && rate <= c.max_sample_rate()
        })
        .ok_or("Requested channels or sample rate are unavailable on this BlackHole device.")?
        .with_sample_rate(rate);
    if let cpal::SupportedBufferSize::Range { min, max } = supported.buffer_size() {
        if buffer_size != 0 && (buffer_size < *min || buffer_size > *max) {
            return Err(format!(
                "Buffer size must be between {min} and {max} frames."
            ));
        }
    }
    let mut config = supported.config();
    config.buffer_size = if buffer_size == 0 {
        cpal::BufferSize::Default
    } else {
        cpal::BufferSize::Fixed(buffer_size)
    };
    let channels = config.channels as usize;
    let capture = Arc::new(Capture::new());
    let audio = capture.clone();
    let errors = capture.clone();
    let stream = device
        .build_input_stream(
            config.clone(),
            move |data: &[f32], _| {
                audio.sequence.fetch_add(1, Ordering::AcqRel);
                let mut count = audio.frames.load(Ordering::Relaxed);
                let mut peak_l = 0.0_f32;
                let mut peak_r = 0.0_f32;
                for frame in data.chunks_exact(channels) {
                    let l = if frame[left_channel].is_finite() {
                        frame[left_channel]
                    } else {
                        0.0
                    };
                    let r = if frame[right_channel].is_finite() {
                        frame[right_channel]
                    } else {
                        0.0
                    };
                    let slot = count as usize % HISTORY;
                    audio.left[slot].store(l.to_bits(), Ordering::Relaxed);
                    audio.right[slot].store(r.to_bits(), Ordering::Relaxed);
                    peak_l = peak_l.max(l.abs());
                    peak_r = peak_r.max(r.abs());
                    count += 1;
                }
                audio.peak_left.store(peak_l.to_bits(), Ordering::Relaxed);
                audio.peak_right.store(peak_r.to_bits(), Ordering::Relaxed);
                audio
                    .last_ms
                    .store(audio.epoch.elapsed().as_millis() as u64, Ordering::Relaxed);
                audio.frames.store(count, Ordering::Release);
                audio.sequence.fetch_add(1, Ordering::Release);
            },
            move |_| {
                errors.failed.store(true, Ordering::Release);
            },
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    let mut engine = shared.lock().map_err(|e| e.to_string())?;
    if engine.generation != generation {
        return Err("Audio start was cancelled or superseded.".into());
    }
    engine.status = AudioStatus {
        running: true,
        device_name: Some(
            device
                .description()
                .map_err(|e| e.to_string())?
                .name()
                .to_owned(),
        ),
        sample_rate: rate,
        channels: config.channels,
        buffer_size: (buffer_size != 0).then_some(buffer_size),
        left_channel,
        right_channel,
        ..AudioStatus::default()
    };
    engine.stream = Some(stream);
    engine.capture = Some(capture);
    Ok(snapshot_status(&engine))
}
#[tauri::command]
fn get_audio_frame(state: tauri::State<AudioState>) -> tauri::ipc::Response {
    let capture = state
        .0
        .lock()
        .ok()
        .and_then(|engine| engine.capture.clone());
    let mut bytes = vec![0_u8; HISTORY * 8];
    if let Some(audio) = capture {
        if !audio.failed.load(Ordering::Acquire) {
            for _ in 0..3 {
                let sequence = audio.sequence.load(Ordering::Acquire);
                if sequence % 2 != 0 {
                    continue;
                }
                let count = audio.frames.load(Ordering::Acquire);
                let valid = count.min(HISTORY as u64) as usize;
                for index in 0..valid {
                    let slot = (count as usize - valid + index) % HISTORY;
                    let out = HISTORY - valid + index;
                    bytes[out * 4..out * 4 + 4]
                        .copy_from_slice(&audio.left[slot].load(Ordering::Relaxed).to_le_bytes());
                    bytes[(HISTORY + out) * 4..(HISTORY + out) * 4 + 4]
                        .copy_from_slice(&audio.right[slot].load(Ordering::Relaxed).to_le_bytes());
                }
                std::sync::atomic::fence(Ordering::Acquire);
                if sequence == audio.sequence.load(Ordering::Acquire) {
                    return tauri::ipc::Response::new(bytes);
                }
            }
            // An unusually busy callback must never stall the renderer or return torn samples.
            bytes.fill(0);
        }
    }
    tauri::ipc::Response::new(bytes)
}
fn main() {
    tauri::Builder::default()
        .manage(AudioState(Arc::new(Mutex::new(Engine::default()))))
        .invoke_handler(tauri::generate_handler![
            list_audio_devices,
            start_audio,
            stop_audio,
            get_audio_status,
            get_audio_frame
        ])
        .run(tauri::generate_context!())
        .expect("Could not launch BlackHole Visualizer");
}
