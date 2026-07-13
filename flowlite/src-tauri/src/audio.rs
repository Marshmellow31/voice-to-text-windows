//! Microphone capture via cpal. Produces 16 kHz mono f32 samples for Whisper.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

/// Holds the live input stream and the growing sample buffer.
pub struct Recorder {
    samples: Arc<Mutex<Vec<f32>>>,
    stream: Option<cpal::Stream>,
    src_rate: u32,
    src_channels: u16,
}

// cpal::Stream is not Send on some platforms; we only touch it from the same
// thread that owns the Recorder, guarded by a Mutex at the app level.
unsafe impl Send for Recorder {}

impl Default for Recorder {
    fn default() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            stream: None,
            src_rate: 16_000,
            src_channels: 1,
        }
    }
}

impl Recorder {
    pub fn new() -> Self {
        Self::default()
    }

    /// True while a stream is active.
    pub fn is_recording(&self) -> bool {
        self.stream.is_some()
    }

    /// Peak amplitude (0.0–1.0) of the most recent audio, for the live level
    /// meter in the overlay pill. Cheap — reads only the buffer tail.
    pub fn current_level(&self) -> f32 {
        let buf = self.samples.lock().unwrap();
        let start = buf.len().saturating_sub(3200); // ~last 0.1–0.2 s
        buf[start..].iter().fold(0.0_f32, |m, &s| m.max(s.abs()))
    }

    /// Begin capturing. Uses the preferred device by name if it's currently
    /// connected, otherwise falls back to the system default (so an unplugged
    /// USB headset never breaks dictation).
    pub fn start(&mut self, preferred: Option<&str>) -> Result<(), String> {
        if self.stream.is_some() {
            return Ok(()); // already recording — ignore (handles key auto-repeat)
        }
        let host = cpal::default_host();
        let device = preferred
            .and_then(|name| {
                host.input_devices()
                    .ok()?
                    .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            })
            .or_else(|| host.default_input_device())
            .ok_or_else(|| "no microphone found".to_string())?;
        let config = device
            .default_input_config()
            .map_err(|e| format!("default input config: {e}"))?;

        self.src_rate = config.sample_rate().0;
        self.src_channels = config.channels();

        let buf = self.samples.clone();
        buf.lock().unwrap().clear();

        let err_fn = |err| eprintln!("audio stream error: {err}");
        let sample_format = config.sample_format();
        let stream_config: cpal::StreamConfig = config.into();

        // Handle the three common sample formats; convert everything to f32.
        let stream = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| buf.lock().unwrap().extend_from_slice(data),
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let mut b = buf.lock().unwrap();
                    b.extend(data.iter().map(|&s| s as f32 / i16::MAX as f32));
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    let mut b = buf.lock().unwrap();
                    b.extend(data.iter().map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0));
                },
                err_fn,
                None,
            ),
            other => return Err(format!("unsupported sample format: {other:?}")),
        }
        .map_err(|e| format!("build input stream: {e}"))?;

        stream.play().map_err(|e| format!("stream play: {e}"))?;
        self.stream = Some(stream);
        Ok(())
    }

    /// Stop capture and return 16 kHz mono samples ready for Whisper.
    pub fn stop(&mut self) -> Vec<f32> {
        self.stream = None; // dropping the stream halts capture
        let raw = self.samples.lock().unwrap().clone();
        let mono = to_mono(&raw, self.src_channels);
        resample_to_16k(&mono, self.src_rate)
    }
}

/// Average interleaved channels down to mono.
fn to_mono(input: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return input.to_vec();
    }
    let ch = channels as usize;
    input
        .chunks(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Linear resample to 16 kHz. Good enough for speech; Whisper is robust to it.
fn resample_to_16k(input: &[f32], src_rate: u32) -> Vec<f32> {
    if src_rate == 16_000 || input.is_empty() {
        return input.to_vec();
    }
    let ratio = src_rate as f32 / 16_000.0;
    let out_len = (input.len() as f32 / ratio).floor() as usize;
    let last = input.len() - 1;
    (0..out_len)
        .map(|i| {
            let pos = i as f32 * ratio;
            let a = pos.floor() as usize;
            let b = (a + 1).min(last);
            let t = pos - a as f32;
            input[a] * (1.0 - t) + input[b] * t
        })
        .collect()
}

/// Peak amplitude — used to skip transcribing near-silence (avoids Whisper
/// hallucinating "Thanks for watching" on empty audio).
pub fn peak_amplitude(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |m, &s| m.max(s.abs()))
}

/// List available input device names for the settings UI.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    match host.input_devices() {
        Ok(devs) => devs.filter_map(|d| d.name().ok()).collect(),
        Err(_) => Vec::new(),
    }
}
