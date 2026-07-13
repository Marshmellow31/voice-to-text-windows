//! Local speech-to-text by shelling out to the bundled whisper.cpp CLI.
//!
//! We avoid the whisper-rs native bindings (bindgen is unreliable on very new
//! Windows toolchains) and instead run the prebuilt `whisper-cli.exe`, which is
//! the same engine. Audio is written to a temp WAV and the CLI prints the text.

use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // don't flash a console window

/// Paths needed to transcribe: the CLI binary and the model file.
pub struct Stt {
    cli_path: PathBuf,
    model_path: PathBuf,
}

impl Stt {
    pub fn new(cli_path: PathBuf, model_path: PathBuf) -> Self {
        Self { cli_path, model_path }
    }

    /// Transcribe 16 kHz mono f32 samples. Writes a temp WAV, runs the CLI,
    /// returns the recognized text.
    pub fn transcribe(&self, audio_16k_mono: &[f32]) -> Result<String, String> {
        if !self.cli_path.exists() {
            return Err(format!("whisper CLI missing at {:?}", self.cli_path));
        }
        if !self.model_path.exists() {
            return Err(format!("model missing at {:?}", self.model_path));
        }

        let wav = write_temp_wav(audio_16k_mono)?;

        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .to_string();

        let mut cmd = Command::new(&self.cli_path);
        cmd.arg("-m")
            .arg(&self.model_path)
            .arg("-f")
            .arg(&wav)
            .arg("-l")
            .arg("en")
            .arg("-t")
            .arg(&threads)
            .arg("-nt") // no timestamps — just the text
            .arg("-np"); // no progress prints

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().map_err(|e| format!("run whisper-cli: {e}"))?;
        let _ = std::fs::remove_file(&wav);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("whisper-cli failed: {stderr}"));
        }

        let text = String::from_utf8_lossy(&output.stdout);
        Ok(clean(&text))
    }
}

/// Whisper CLI prints one line per segment; join and tidy whitespace.
fn clean(raw: &str) -> String {
    raw.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Write f32 samples as a 16 kHz mono 16-bit PCM WAV to a temp file.
fn write_temp_wav(samples: &[f32]) -> Result<PathBuf, String> {
    let path = unique_temp_path();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        hound::WavWriter::create(&path, spec).map_err(|e| format!("wav create: {e}"))?;
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(v).map_err(|e| format!("wav write: {e}"))?;
    }
    writer.finalize().map_err(|e| format!("wav finalize: {e}"))?;
    Ok(path)
}

/// A temp WAV path that won't collide between rapid dictations.
fn unique_temp_path() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let mut dir = std::env::temp_dir();
    dir.push(format!("flowlite-{pid}-{n}.wav"));
    dir
}
