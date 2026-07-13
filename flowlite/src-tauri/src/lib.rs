mod audio;
mod history;
mod inject;
mod model;
mod stt;

use audio::Recorder;
use history::{HistoryEntry, Stats, Store};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use stt::Stt;
use tauri::{
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Below this peak amplitude we treat the clip as silence and skip transcription.
const SILENCE_THRESHOLD: f32 = 0.01;

#[derive(Clone, Serialize, Deserialize)]
pub struct Settings {
    pub hotkey: String,
    pub model_id: String,
    pub mic: Option<String>,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "F9".to_string(),
            model_id: "small.en".to_string(),
            mic: None,
            autostart: false,
        }
    }
}

pub struct AppState {
    recorder: Mutex<Recorder>,
    settings: Mutex<Settings>,
    store: Mutex<Store>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s: String| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
}

fn persist_settings(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let p = settings_path(app)?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(p, json).map_err(|e| e.to_string())
}

/// Path to the bundled whisper CLI (works in dev and in the installed app).
fn whisper_cli_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/whisper/whisper-cli.exe", BaseDirectory::Resource)
        .map_err(|e| format!("resolve cli: {e}"))
}

/// True when the selected model file is present (so we can dictate).
fn model_is_ready(app: &AppHandle) -> bool {
    let id = app.state::<AppState>().settings.lock().unwrap().model_id.clone();
    model::is_downloaded(app, &id) && whisper_cli_path(app).map(|p| p.exists()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Overlay pill window
// ---------------------------------------------------------------------------

fn show_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("overlay") {
        if let Ok(Some(monitor)) = win.current_monitor() {
            let screen = monitor.size();
            if let Ok(win_size) = win.outer_size() {
                let x = (screen.width.saturating_sub(win_size.width)) / 2;
                let y = screen.height.saturating_sub(win_size.height + 80);
                let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
            }
        }
        let _ = win.show();
    }
}

fn hide_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
}

// ---------------------------------------------------------------------------
// Core dictation flow
// ---------------------------------------------------------------------------

fn on_hotkey_pressed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut rec = state.recorder.lock().unwrap();
    if rec.is_recording() {
        return; // ignore key auto-repeat
    }
    match rec.start() {
        Ok(()) => {
            let _ = app.emit("recording-started", ());
            show_overlay(app);
        }
        Err(e) => {
            let _ = app.emit("dictation-error", e);
        }
    }
}

/// Payload for the "dictation-done" event.
#[derive(Clone, Serialize)]
struct DictationDone {
    text: String,
    words: u32,
    dur_secs: f32,
}

/// Whisper emits bracketed tokens like "[BLANK_AUDIO]" on near-silence;
/// those must not pollute history or stats.
fn is_noise_token(text: &str) -> bool {
    (text.starts_with('[') && text.ends_with(']'))
        || (text.starts_with('(') && text.ends_with(')'))
}

fn on_hotkey_released(app: &AppHandle) {
    let state = app.state::<AppState>();
    // Stop capture synchronously (same thread that started it).
    let samples = {
        let mut rec = state.recorder.lock().unwrap();
        if !rec.is_recording() {
            return;
        }
        rec.stop()
    };
    let _ = app.emit("recording-stopped", ());

    // Resolve paths for the transcription thread.
    let model_id = state.settings.lock().unwrap().model_id.clone();
    let cli = whisper_cli_path(app);
    let model = model::model_path(app, &model_id);
    let dur_secs = samples.len() as f32 / 16_000.0;
    let app = app.clone();

    std::thread::spawn(move || {
        let result = (|| {
            if audio::peak_amplitude(&samples) < SILENCE_THRESHOLD {
                return Ok(String::new()); // silence — nothing to do
            }
            let cli = cli?;
            let model = model?;
            let engine = Stt::new(cli, model);
            let text = engine.transcribe(&samples)?;
            if !text.is_empty() {
                inject::inject_text(&text)?;
            }
            Ok::<String, String>(text)
        })();

        match result {
            Ok(text) => {
                let words = text.split_whitespace().count() as u32;
                if !text.is_empty() && !is_noise_token(&text) {
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let entry = HistoryEntry { ts, text: text.clone(), words, dur_secs };
                    let state = app.state::<AppState>();
                    let mut store = state.store.lock().unwrap();
                    if let Err(e) = store.record(&app, entry) {
                        eprintln!("history write failed: {e}");
                    }
                }
                let _ = app.emit("dictation-done", DictationDone { text, words, dur_secs });
            }
            Err(e) => {
                let _ = app.emit("dictation-error", e);
            }
        }
        hide_overlay(&app);
    });
}

// ---------------------------------------------------------------------------
// Hotkey registration
// ---------------------------------------------------------------------------

fn register_hotkey(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(accelerator)
        .map_err(|e| format!("register '{accelerator}': {e}"))
}

// ---------------------------------------------------------------------------
// Tauri commands (called from React)
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: tauri::State<AppState>,
    new_settings: Settings,
) -> Result<(), String> {
    let old = state.settings.lock().unwrap().clone();

    if old.hotkey != new_settings.hotkey {
        register_hotkey(&app, &new_settings.hotkey)?;
    }
    if old.autostart != new_settings.autostart {
        use tauri_plugin_autostart::ManagerExt;
        let al = app.autolaunch();
        if new_settings.autostart {
            let _ = al.enable();
        } else {
            let _ = al.disable();
        }
    }

    *state.settings.lock().unwrap() = new_settings.clone();
    persist_settings(&app, &new_settings)?;
    Ok(())
}

#[tauri::command]
fn list_mics() -> Vec<String> {
    audio::list_input_devices()
}

#[derive(Serialize)]
struct ModelInfo {
    id: String,
    downloaded: bool,
}

#[tauri::command]
fn list_models(app: AppHandle) -> Vec<ModelInfo> {
    model::MODELS
        .iter()
        .map(|(id, _, _)| ModelInfo {
            id: id.to_string(),
            downloaded: model::is_downloaded(&app, id),
        })
        .collect()
}

#[tauri::command]
fn model_ready(app: AppHandle) -> bool {
    model_is_ready(&app)
}

/// Download a model on a background thread, emitting progress + completion.
#[tauri::command]
fn download_model(app: AppHandle, id: String) {
    std::thread::spawn(move || match model::download(&app, &id) {
        Ok(()) => {
            let _ = app.emit("model-ready", id);
        }
        Err(e) => {
            let _ = app.emit("model-error", e);
        }
    });
}

#[tauri::command]
fn get_history(state: tauri::State<AppState>) -> Vec<HistoryEntry> {
    // Stored oldest-first; UI wants newest-first.
    let mut entries = state.store.lock().unwrap().entries.clone();
    entries.reverse();
    entries
}

#[tauri::command]
fn delete_history_entry(
    app: AppHandle,
    state: tauri::State<AppState>,
    ts: u64,
) -> Result<(), String> {
    state.store.lock().unwrap().delete(&app, ts)
}

#[tauri::command]
fn clear_history(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    state.store.lock().unwrap().clear_entries(&app)
}

#[tauri::command]
fn get_stats(state: tauri::State<AppState>) -> Stats {
    state.store.lock().unwrap().stats.clone()
}

/// Copy text to the clipboard (used by the history panel's copy button —
/// arboard is reliable where WebView2's navigator.clipboard is not).
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_settings_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| match event.state() {
                    ShortcutState::Pressed => on_hotkey_pressed(app),
                    ShortcutState::Released => on_hotkey_released(app),
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = load_settings(&handle);

            if let Err(e) = register_hotkey(&handle, &settings.hotkey) {
                eprintln!("hotkey register failed: {e}");
            }

            app.manage(AppState {
                recorder: Mutex::new(Recorder::new()),
                settings: Mutex::new(settings),
                store: Mutex::new(Store::load(&handle)),
            });

            // System tray.
            let show_i = MenuItem::with_id(app, "show", "Settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("FlowLite — hold your hotkey to dictate")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_mics,
            list_models,
            model_ready,
            download_model,
            show_settings_window,
            get_history,
            delete_history_entry,
            clear_history,
            get_stats,
            copy_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
