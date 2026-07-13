//! Optional local AI rewrite. Runs Qwen2.5-3B-Instruct through a bundled-on-
//! demand llama.cpp CUDA build as a subprocess — same pattern as Whisper.
//! Everything is local; no network at inference time.

use crate::net;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// llama.cpp b9992 CUDA 12.4 Windows build + its CUDA runtime DLLs.
const LLAMA_URL: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b9992/llama-b9992-bin-win-cuda-12.4-x64.zip";
const CUDART_URL: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b9992/cudart-llama-bin-win-cuda-12.4-x64.zip";
// Qwen2.5-3B-Instruct, Q4_K_M quant (~1.9 GB). HuggingFace first, then
// ModelScope (Alibaba's own hub — reliable where HF's Xet CDN is blocked).
const MODEL_URLS: &[&str] = &[
    "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
    "https://modelscope.cn/models/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/master/qwen2.5-3b-instruct-q4_k_m.gguf",
];
const MODEL_FILE: &str = "qwen2.5-3b-instruct-q4_k_m.gguf";

/// A text transformation the model can apply.
#[derive(Clone, Copy)]
pub enum Preset {
    Formal,
    Bullets,
    Concise,
    Grammar,
}

impl Preset {
    pub fn from_id(s: &str) -> Option<Preset> {
        match s {
            "formal" => Some(Preset::Formal),
            "bullets" => Some(Preset::Bullets),
            "concise" => Some(Preset::Concise),
            "grammar" => Some(Preset::Grammar),
            _ => None,
        }
    }

    fn system_prompt(self) -> &'static str {
        match self {
            Preset::Formal => "You are an editor. Rewrite the user's text to be polished, clear and professional while keeping the original meaning. Output only the rewritten text, with no preamble or quotation marks.",
            Preset::Bullets => "You are an editor. Rewrite the user's text as a concise bulleted list capturing the key points. Output only the bullet list, using '- ' for each bullet.",
            Preset::Concise => "You are an editor. Rewrite the user's text to be as concise as possible while preserving the meaning. Output only the rewritten text, with no preamble.",
            Preset::Grammar => "You are a proofreader. Correct spelling, grammar and punctuation in the user's text without changing its meaning, tone or wording beyond what is necessary. Output only the corrected text.",
        }
    }
}

fn llm_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("llm"))
}

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(llm_dir(app)?.join("bin"))
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(llm_dir(app)?.join(MODEL_FILE))
}

/// The llama-cli.exe once installed, else None.
fn llama_cli(app: &AppHandle) -> Option<PathBuf> {
    let dir = bin_dir(app).ok()?;
    net::find_file(&dir, "llama-cli.exe")
}

pub fn is_ready(app: &AppHandle) -> bool {
    llama_cli(app).is_some()
        && model_path(app).map(|p| p.exists()).unwrap_or(false)
}

/// Download the runtime (binaries + CUDA DLLs) and the model. Blocking.
pub fn download(app: &AppHandle) -> Result<(), String> {
    let bin = bin_dir(app)?;
    std::fs::create_dir_all(&bin).map_err(|e| format!("create bin dir: {e}"))?;

    // 1) llama.cpp CUDA binaries
    let llama_zip = bin.join("llama.zip");
    net::download_file(app, &[LLAMA_URL], &llama_zip, "llm-download-progress", "AI runtime")?;
    net::extract_zip(&llama_zip, &bin)?;
    let _ = std::fs::remove_file(&llama_zip);

    // 2) CUDA runtime DLLs (extracted alongside the binaries)
    let cudart_zip = bin.join("cudart.zip");
    net::download_file(app, &[CUDART_URL], &cudart_zip, "llm-download-progress", "CUDA runtime")?;
    net::extract_zip(&cudart_zip, &bin)?;
    let _ = std::fs::remove_file(&cudart_zip);

    // 3) the model itself (HF, then ModelScope mirror)
    let model = model_path(app)?;
    net::download_file(app, MODEL_URLS, &model, "llm-download-progress", "AI model")?;

    if llama_cli(app).is_none() {
        return Err("llama-cli.exe not found after extracting AI runtime".into());
    }
    Ok(())
}

/// Rewrite `text` with the given preset. Blocking; runs the model once.
pub fn rewrite(app: &AppHandle, text: &str, preset: Preset) -> Result<String, String> {
    let cli = llama_cli(app).ok_or("AI runtime not installed")?;
    let model = model_path(app)?;
    if !model.exists() {
        return Err("AI model not downloaded".into());
    }
    let input = text.trim();
    if input.is_empty() {
        return Ok(String::new());
    }

    // Qwen2.5 ChatML prompt. --no-display-prompt makes stdout the completion only.
    let prompt = format!(
        "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
        preset.system_prompt(),
        input
    );

    let mut cmd = Command::new(&cli);
    cmd.arg("-m")
        .arg(&model)
        .arg("-p")
        .arg(&prompt)
        .arg("-n")
        .arg("512") // max new tokens
        .arg("-c")
        .arg("4096") // context
        .arg("-ngl")
        .arg("99") // offload all layers to the GPU
        .arg("--temp")
        .arg("0.3")
        .arg("--top-p")
        .arg("0.9")
        .arg("-no-cnv") // one-shot, not interactive chat
        .arg("--no-display-prompt")
        .arg("--simple-io");

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("run llama-cli: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AI rewrite failed: {stderr}"));
    }
    Ok(clean(&String::from_utf8_lossy(&output.stdout)))
}

/// Strip control tokens and trailing markers llama-cli may emit.
fn clean(raw: &str) -> String {
    let mut s = raw.to_string();
    for marker in ["<|im_end|>", "[end of text]", "<|endoftext|>"] {
        if let Some(i) = s.find(marker) {
            s.truncate(i);
        }
    }
    s.trim().trim_matches('"').trim().to_string()
}

/// If `text` opens with a spoken transform command, return the preset and the
/// remaining payload to transform (e.g. "make this formal hi there" -> hi there).
pub fn detect_command(text: &str) -> Option<(Preset, String)> {
    let trimmed = text.trim_start();
    let lower = trimmed.to_lowercase();
    // Longest phrases first so "make this concise" wins over any prefix.
    const TABLE: &[(&str, Preset)] = &[
        ("make this formal", Preset::Formal),
        ("make it formal", Preset::Formal),
        ("make this professional", Preset::Formal),
        ("rewrite this", Preset::Formal),
        ("make this concise", Preset::Concise),
        ("make it concise", Preset::Concise),
        ("make this shorter", Preset::Concise),
        ("summarize this", Preset::Concise),
        ("bullet point this", Preset::Bullets),
        ("make bullet points", Preset::Bullets),
        ("bullet points", Preset::Bullets),
        ("fix the grammar", Preset::Grammar),
        ("fix grammar", Preset::Grammar),
        ("fix spelling", Preset::Grammar),
    ];
    for (phrase, preset) in TABLE {
        if lower.starts_with(phrase) {
            // Phrases are ASCII, so byte offsets line up with `trimmed`.
            let payload = trimmed[phrase.len()..]
                .trim_start_matches([':', ',', '.', ' ', '-'])
                .trim()
                .to_string();
            if !payload.is_empty() {
                return Some((*preset, payload));
            }
        }
    }
    None
}
