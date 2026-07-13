//! Shared download + unzip helpers for on-demand components (large Whisper
//! models, the CUDA engine, the local LLM runtime + model).
//!
//! Downloads go through the system `curl`, not an in-process HTTP client.
//! HuggingFace now serves files from its Xet storage, whose redirect lands on a
//! CloudFront/S3 presigned URL. Rust HTTP clients (ureq) normalise the query
//! string when following the redirect — decoding `%7E` back to `~` in the
//! signature — which invalidates it and yields `AccessDenied`. `curl` forwards
//! the URL byte-for-byte, so it just works. Blocking — call from a thread.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd;
}

/// Best-effort total size via a HEAD request. HuggingFace returns the true LFS
/// size in `x-linked-size`; GitHub/S3 return `content-length` after redirects.
/// We take the largest number seen so a small pointer response never wins.
fn head_size(url: &str) -> u64 {
    let mut cmd = Command::new("curl");
    cmd.args(["-sIL", "--retry", "2", url]);
    no_window(&mut cmd);
    let out = match cmd.output() {
        Ok(o) => o,
        Err(_) => return 0,
    };
    let headers = String::from_utf8_lossy(&out.stdout).to_lowercase();
    headers
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            for key in ["x-linked-size:", "content-length:"] {
                if let Some(v) = l.strip_prefix(key) {
                    return v.trim().parse::<u64>().ok();
                }
            }
            None
        })
        .max()
        .unwrap_or(0)
}

/// Download to `dest`, trying each URL in `urls` in order until one succeeds
/// (e.g. HuggingFace first, then a ModelScope mirror for networks that can't
/// reach HF's Xet CDN). Emits `{stage, received, total}` on `event`.
pub fn download_file(
    app: &AppHandle,
    urls: &[&str],
    dest: &Path,
    event: &str,
    stage: &str,
) -> Result<(), String> {
    if dest.exists() {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }

    let mut last_err = "no download URL configured".to_string();
    for url in urls {
        match download_one(app, url, dest, event, stage) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = e, // try the next mirror
        }
    }
    Err(format!("download failed ({stage}): {last_err}"))
}

/// Download a single URL to `dest`. Writes to a `.part` file first, polling its
/// size on a side thread for progress, then renames on success.
fn download_one(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    event: &str,
    stage: &str,
) -> Result<(), String> {
    let tmp = dest.with_extension("part");
    let _ = std::fs::remove_file(&tmp); // discard any stale partial

    let total = head_size(url);

    let stop = Arc::new(AtomicBool::new(false));
    let poller = {
        let stop = stop.clone();
        let app = app.clone();
        let tmp = tmp.clone();
        let event = event.to_string();
        let stage = stage.to_string();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                let received = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
                let _ = app.emit(
                    &event,
                    serde_json::json!({ "stage": stage, "received": received, "total": total }),
                );
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        })
    };

    let mut cmd = Command::new("curl");
    cmd.args(["-L", "-f", "-s", "--retry", "3", "--retry-delay", "2", "-o"])
        .arg(&tmp)
        .arg(url);
    no_window(&mut cmd);
    let status = cmd.status().map_err(|e| format!("run curl: {e}"))?;

    stop.store(true, Ordering::Relaxed);
    let _ = poller.join();

    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("curl exit {} for {url}", status.code().unwrap_or(-1)));
    }

    std::fs::rename(&tmp, dest).map_err(|e| format!("finalize: {e}"))?;
    let final_size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(total);
    let _ = app.emit(
        event,
        serde_json::json!({ "stage": stage, "received": final_size, "total": final_size }),
    );
    Ok(())
}

/// Extract every entry of `zip_path` into `dest` (directories created as needed).
pub fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read zip: {e}"))?;
    std::fs::create_dir_all(dest).map_err(|e| format!("create dest: {e}"))?;
    archive.extract(dest).map_err(|e| format!("extract zip: {e}"))?;
    Ok(())
}

/// Recursively find the first file named `name` under `dir` (zip layouts vary,
/// so we don't assume where the exe lands).
pub fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file(&p, name) {
                return Some(found);
            }
        } else if p.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(p);
        }
    }
    None
}
