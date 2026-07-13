//! Optional CUDA acceleration for Whisper. The GPU engine (a cuBLAS build of
//! whisper.cpp, self-contained with the CUDA runtime DLLs) is downloaded on
//! demand into the app-data dir and used in place of the bundled CPU engine.

use crate::net;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// whisper.cpp v1.9.1 cuBLAS (CUDA 12.4) Windows build — bundles whisper-cli.exe,
/// ggml-cuda.dll and the CUDA runtime DLLs, so nothing else is needed.
const WHISPER_CUDA_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-cublas-12.4.0-bin-x64.zip";

/// %APPDATA%\<app>\accel\whisper-cuda\
fn accel_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("accel")
        .join("whisper-cuda"))
}

/// Path to the CUDA whisper-cli.exe once installed, else None.
pub fn cli_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = accel_dir(app).ok()?;
    net::find_file(&dir, "whisper-cli.exe")
}

pub fn is_ready(app: &AppHandle) -> bool {
    cli_path(app).map(|p| p.exists()).unwrap_or(false)
}

/// Download and unpack the CUDA engine. Blocking — call from a thread.
pub fn download(app: &AppHandle) -> Result<(), String> {
    let dir = accel_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create accel dir: {e}"))?;
    let zip = dir.join("whisper-cuda.zip");
    net::download_file(app, &[WHISPER_CUDA_URL], &zip, "gpu-download-progress", "GPU engine")?;
    net::extract_zip(&zip, &dir)?;
    let _ = std::fs::remove_file(&zip);
    if cli_path(app).is_none() {
        return Err("whisper-cli.exe not found after extracting GPU engine".into());
    }
    Ok(())
}
