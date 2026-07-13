//! Whisper model management: where models live, and one-time download.

use crate::net;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Available models, cheapest -> most accurate. Each has one or more download
/// URLs tried in order: HuggingFace first, then a ModelScope mirror for
/// networks that can't reach HF's Xet CDN (which is geo-blocked in places).
/// Note: large-v3-turbo has no ModelScope mirror, so it's HF-only.
pub const MODELS: &[(&str, &str, &[&str])] = &[
    (
        "tiny.en",
        "ggml-tiny.en-q5_1.bin",
        &[
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
            "https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-tiny.en-q5_1.bin",
        ],
    ),
    (
        "base.en",
        "ggml-base.en-q5_1.bin",
        &[
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin",
            "https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-base.en-q5_1.bin",
        ],
    ),
    (
        "small.en",
        "ggml-small.en-q5_1.bin",
        &[
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin",
            "https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-small.en-q5_1.bin",
        ],
    ),
    (
        "medium.en",
        "ggml-medium.en-q5_0.bin",
        &[
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-q5_0.bin",
            "https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-medium.en-q5_0.bin",
        ],
    ),
    (
        "large-v3-turbo",
        "ggml-large-v3-turbo-q5_0.bin",
        &["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"],
    ),
    (
        "large-v3",
        "ggml-large-v3-q5_0.bin",
        &[
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
            "https://modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/ggml-large-v3-q5_0.bin",
        ],
    ),
];

pub fn model_meta(id: &str) -> Option<(&'static str, &'static str, &'static [&'static str])> {
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

/// Download a model, emitting `model-download-progress` events to the UI.
/// Uses the shared curl-based downloader (handles HuggingFace Xet URLs, which
/// an in-process HTTP client mangles). Blocking — call from a background thread.
pub fn download(app: &AppHandle, id: &str) -> Result<(), String> {
    let (_, _, urls) = model_meta(id).ok_or_else(|| format!("unknown model: {id}"))?;
    let dest = model_path(app, id)?;
    net::download_file(app, urls, &dest, "model-download-progress", id)
}
