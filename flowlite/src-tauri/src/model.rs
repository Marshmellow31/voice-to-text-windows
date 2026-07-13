//! Whisper model management: where models live, and one-time download.

use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

/// Available models, cheapest -> most accurate.
pub const MODELS: &[(&str, &str, &str)] = &[
    // (id, filename, download url)
    (
        "tiny.en",
        "ggml-tiny.en-q5_1.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
    ),
    (
        "base.en",
        "ggml-base.en-q5_1.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin",
    ),
    (
        "small.en",
        "ggml-small.en-q5_1.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin",
    ),
];

pub fn model_meta(id: &str) -> Option<(&'static str, &'static str, &'static str)> {
    MODELS.iter().copied().find(|(mid, _, _)| *mid == id)
}

/// Directory where model files are stored: %APPDATA%\<app>\models\
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create models dir: {e}"))?;
    Ok(dir)
}

/// Full path to a model file (may not exist yet).
pub fn model_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let (_, filename, _) = model_meta(id).ok_or_else(|| format!("unknown model: {id}"))?;
    Ok(models_dir(app)?.join(filename))
}

pub fn is_downloaded(app: &AppHandle, id: &str) -> bool {
    model_path(app, id).map(|p| p.exists()).unwrap_or(false)
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    id: String,
    received: u64,
    total: u64,
}

/// Download a model, emitting `model-download-progress` events to the UI.
/// Blocking — call from a background thread.
pub fn download(app: &AppHandle, id: &str) -> Result<(), String> {
    let (_, _, url) = model_meta(id).ok_or_else(|| format!("unknown model: {id}"))?;
    let dest = model_path(app, id)?;
    if dest.exists() {
        return Ok(());
    }

    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("download request: {e}"))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let tmp = dest.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create file: {e}"))?;
    let mut reader = resp.into_reader();
    let mut buf = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;

    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buf[..n]).map_err(|e| format!("write: {e}"))?;
        received += n as u64;
        // Throttle events to every ~1 MB.
        if received - last_emit > 1_000_000 {
            last_emit = received;
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    id: id.to_string(),
                    received,
                    total,
                },
            );
        }
    }
    drop(file);
    std::fs::rename(&tmp, &dest).map_err(|e| format!("finalize: {e}"))?;
    let _ = app.emit(
        "model-download-progress",
        DownloadProgress {
            id: id.to_string(),
            received,
            total: received,
        },
    );
    Ok(())
}
