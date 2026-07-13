# FlowLite — Local Voice-to-Text for Windows

> A Wispr Flow clone: hold a hotkey anywhere in Windows, speak, release — your words are typed into whatever app has focus. 100% local, no tokens, no limits, no subscription.

---

## 1. How Wispr Flow Actually Works (and what we're recreating)

Wispr Flow is, at its core, four systems glued together:

| System | What it does | Our equivalent |
|---|---|---|
| **Global hotkey listener** | Detects key **press** (start recording) and **release** (stop) even when the app is in the background | Tauri `global-shortcut` plugin (supports press/release events) |
| **Audio capture** | Records mic audio while the key is held | `cpal` (Rust audio library) → 16 kHz mono PCM |
| **Speech-to-text engine** | Wispr sends audio to their cloud (that's why you have token limits) | **whisper.cpp running locally** — this is how we escape the limits |
| **Text injection** | Types the result into the focused app (VS Code, browser, Slack, anywhere) | Clipboard + simulated `Ctrl+V` via `enigo` |

Plus the supporting cast: a system-tray icon, a tiny "recording…" overlay pill, a settings window (the React UI), and auto-start on boot.

**The key insight:** Wispr's token limit exists because *their* servers do the transcription. Whisper is open-source — running it on your own CPU means unlimited use forever.

---

## 2. Feature List

### MVP (Phase 1–7 below)
- ✅ Push-to-talk: hold `Ctrl+Space` (configurable) anywhere in Windows → speak → release → text appears in the focused app
- ✅ Fully offline transcription (whisper.cpp, `small.en` quantized model)
- ✅ Floating "listening" pill overlay while recording (like Wispr's bottom bar)
- ✅ System tray icon: enable/disable, open settings, quit
- ✅ Settings UI (React + Tailwind): hotkey, microphone, model size, launch-on-startup toggle
- ✅ Auto-start with Windows
- ✅ Single portable `.exe` installer (NSIS) ~15 MB + model file

### V2 (later)
- Toggle mode (tap to start, tap to stop) in addition to hold mode
- Custom dictionary / auto-replace ("btw" → "by the way", your name spelled right)
- Transcription history panel
- Punctuation/filler cleanup ("um", "uh" removal — Whisper mostly handles this already)
- Optional AI polish pass (send text to Claude API to reformat as email/message — this is Wispr's "tones" feature)
- Multilingual model option (`small` instead of `small.en`)

---

## 3. Tech Stack — Final Decision

| Layer | Choice | Why |
|---|---|---|
| UI | **React 18 + Tailwind CSS + Vite** | What you asked for; hot-reload dev experience |
| Desktop shell | **Tauri v2** (not Electron, not React Native) | 10 MB exe vs Electron's 150 MB; ~60 MB RAM vs ~300 MB; native Rust backend gives us free access to audio/hotkey/injection libraries |
| Backend logic | **Rust** (comes with Tauri) | Audio capture, Whisper inference, keystroke injection all happen here |
| STT engine | **whisper.cpp** via the `whisper-rs` crate | Best accuracy-per-CPU-cycle available locally; GGML quantized models |
| Model | **`ggml-small.en-q5_1.bin`** (~182 MB) | Sweet spot: near-cloud accuracy for English, ~1× real-time on a modern laptop CPU. Fallback: `base.en-q5_1` (~57 MB) for older machines |
| Audio | `cpal` crate | Cross-platform mic capture |
| Text injection | `arboard` (clipboard) + `enigo` (sends Ctrl+V) | Paste is instant and reliable across all apps; per-character typing is the fallback |
| Packaging | Tauri bundler → **NSIS `.exe` installer** | One command: `npm run tauri build` |

### Why not React Native?
React Native targets iOS/Android. RN-for-Windows exists but is heavyweight, poorly maintained for this use case, and has no story for global hotkeys, raw audio, or keystroke injection. **You still write React + Tailwind with Tauri** — the UI code is identical to a web app; only the wrapper differs.

### Why not Electron?
It works, but it bundles all of Chromium: 150+ MB install, 250–400 MB RAM always resident. For an always-running background utility, Tauri (which uses Windows' built-in WebView2) is the professional choice. This is exactly why apps like this feel "light."

### Model size cheat sheet (all run offline, download once)

| Model | Disk | RAM in use | Speed (modern CPU) | Accuracy |
|---|---|---|---|---|
| `tiny.en-q5_1` | 31 MB | ~120 MB | ~5× real-time | OK for clear speech |
| `base.en-q5_1` | 57 MB | ~200 MB | ~3× real-time | Good |
| **`small.en-q5_1`** ⭐ | 182 MB | ~500 MB | ~1–1.5× real-time | Very good — recommended |
| `medium.en-q5_0` | 515 MB | ~1.2 GB | slower than real-time on many laptops | Excellent |

("1× real-time" = a 5-second clip transcribes in ~5 seconds. Since clips are short — you speak a sentence or two — even 1× feels instant.)

Models download from: `https://huggingface.co/ggerganov/whisper.cpp/tree/main`

---

## 4. Architecture

```
┌────────────────────────────── FlowLite.exe (Tauri) ──────────────────────────────┐
│                                                                                  │
│  React + Tailwind (WebView2)          Rust backend (the real work)               │
│  ┌──────────────────────────┐         ┌────────────────────────────────────────┐ │
│  │ Settings window          │  Tauri  │ global-shortcut plugin                 │ │
│  │  - hotkey picker         │◄──IPC──►│   on Pressed  → start_recording()      │ │
│  │  - mic picker            │ events  │   on Released → stop → transcribe()    │ │
│  │  - model picker          │         │                                        │ │
│  │  - autostart toggle      │         │ cpal: mic → Vec<f32> @16 kHz mono      │ │
│  ├──────────────────────────┤         │ whisper-rs: audio → String             │ │
│  │ Overlay pill window      │         │ arboard+enigo: String → Ctrl+V paste   │ │
│  │  "● Listening…"          │         │ tray icon / autostart plugins          │ │
│  └──────────────────────────┘         └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
                    │                                    │
              you configure it                 works in ANY focused app:
                                               VS Code, Chrome, Slack, Word…
```

**Flow of one dictation:**
1. You hold `Ctrl+Space` → Rust gets a `Pressed` event → starts `cpal` mic stream, shows overlay pill
2. You speak; samples accumulate in a buffer (resampled to 16 kHz mono f32)
3. You release → `Released` event → stream stops, overlay shows "Transcribing…"
4. Buffer goes into whisper.cpp → text comes out (~0.5–2 s for a sentence)
5. Text is placed on the clipboard, `Ctrl+V` is simulated, your old clipboard is restored
6. Overlay hides. Total feel: speak → text appears ~1 second after you stop.

---

## 5. Prerequisites (install once)

1. **Node.js 20+** — https://nodejs.org
2. **Rust** — https://rustup.rs (run `rustup-init.exe`, accept defaults)
3. **Visual Studio Build Tools 2022** — https://visualstudio.microsoft.com/visual-cpp-build-tools/ — check **"Desktop development with C++"** (Rust and whisper.cpp both need MSVC). Also install **CMake** (checkbox inside the same installer, or from cmake.org) — whisper.cpp's build needs it.
4. **WebView2** — already on Windows 11, nothing to do.

Verify in a fresh terminal:
```powershell
node -v      # v20+
cargo -V     # 1.7x+
cmake --version
```

---

## 6. Build Guide — Phase by Phase

Each phase ends with something you can run and test. Don't move on until the checkpoint passes.

### Phase 0 — Scaffold the project

```powershell
npm create tauri-app@latest flowlite -- --template react-ts
cd flowlite
npm install
npm install -D tailwindcss @tailwindcss/vite
npm run tauri dev   # checkpoint: a desktop window opens with the starter app
```

Wire Tailwind v4 into `vite.config.ts`:
```ts
import tailwindcss from "@tailwindcss/vite";
// add tailwindcss() to the plugins array
```
and put `@import "tailwindcss";` at the top of `src/App.css`.

Project layout you'll end up with:
```
flowlite/
├── src/                  # React UI
│   ├── App.tsx           # settings window
│   └── Overlay.tsx       # recording pill
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── lib.rs        # app setup, plugin wiring
│   │   ├── audio.rs      # cpal recording
│   │   ├── stt.rs        # whisper-rs transcription
│   │   └── inject.rs     # clipboard paste
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

### Phase 1 — Rust dependencies

`src-tauri/Cargo.toml`:
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-autostart = "2"
tauri-plugin-store = "2"        # persists settings as JSON
cpal = "0.15"                   # mic capture
whisper-rs = "0.14"             # whisper.cpp bindings (compiles whisper.cpp for you)
arboard = "3"                   # clipboard
enigo = "0.3"                   # simulate Ctrl+V
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

First `cargo build` after adding `whisper-rs` takes several minutes — it's compiling whisper.cpp from source. That's normal and happens once.

### Phase 2 — Audio capture (`audio.rs`)

Goal: start/stop a mic stream; produce `Vec<f32>` at **16 kHz mono** (Whisper's required format — feed it anything else and you get garbage).

```rust
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub struct Recorder {
    samples: Arc<Mutex<Vec<f32>>>,
    stream: Option<cpal::Stream>,
    src_rate: u32,
    src_channels: u16,
}

impl Recorder {
    pub fn start(&mut self) -> Result<(), String> {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or("no microphone found")?;
        let config = device.default_input_config().map_err(|e| e.to_string())?;
        self.src_rate = config.sample_rate().0;
        self.src_channels = config.channels();

        let buf = self.samples.clone();
        buf.lock().unwrap().clear();

        let stream = device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _| buf.lock().unwrap().extend_from_slice(data),
                |err| eprintln!("stream error: {err}"),
                None,
            )
            .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        self.stream = Some(stream);
        Ok(())
    }

    /// Stop and return 16 kHz mono samples ready for Whisper.
    pub fn stop(&mut self) -> Vec<f32> {
        self.stream = None; // dropping the stream stops capture
        let raw = self.samples.lock().unwrap().clone();
        let mono = to_mono(&raw, self.src_channels);
        resample_to_16k(&mono, self.src_rate)
    }
}

fn to_mono(input: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 { return input.to_vec(); }
    input.chunks(channels as usize)
         .map(|frame| frame.iter().sum::<f32>() / channels as f32)
         .collect()
}

/// Simple linear resampler — fine for speech.
fn resample_to_16k(input: &[f32], src_rate: u32) -> Vec<f32> {
    if src_rate == 16_000 { return input.to_vec(); }
    let ratio = src_rate as f32 / 16_000.0;
    let out_len = (input.len() as f32 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f32 * ratio;
            let (a, b) = (pos.floor() as usize, (pos.floor() as usize + 1).min(input.len() - 1));
            let t = pos.fract();
            input[a] * (1.0 - t) + input[b] * t
        })
        .collect()
}
```

> ⚠️ **The #1 pitfall of this whole project:** most mics record at 44.1 kHz or 48 kHz stereo. Whisper requires 16 kHz mono. Skip the resample step and transcription silently produces nonsense.

**Checkpoint:** temporary Tauri command that records 3 s and logs sample count (should be ~48,000 after resampling).

### Phase 3 — Whisper transcription (`stt.rs`)

```rust
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct Stt { ctx: WhisperContext }

impl Stt {
    pub fn load(model_path: &str) -> Result<Self, String> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| e.to_string())?;
        Ok(Self { ctx })
    }

    pub fn transcribe(&self, audio_16k_mono: &[f32]) -> Result<String, String> {
        let mut state = self.ctx.create_state().map_err(|e| e.to_string())?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_progress(false);
        params.set_print_special(false);
        params.set_suppress_blank(true);
        params.set_no_timestamps(true);

        state.full(params, audio_16k_mono).map_err(|e| e.to_string())?;

        let mut text = String::new();
        for i in 0..state.full_n_segments().map_err(|e| e.to_string())? {
            text.push_str(&state.full_get_segment_text(i).map_err(|e| e.to_string())?);
        }
        Ok(text.trim().to_string())
    }
}
```

**Model handling:** on first launch, download `ggml-small.en-q5_1.bin` from
`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin`
into `%APPDATA%\flowlite\models\` (show a progress bar in the UI). Don't bundle it in the installer — keeps the exe small and lets users switch models.

Load the model **once at app startup** into managed state (`app.manage(Mutex::new(stt))`), never per-dictation — loading takes ~1 s, and doing it per-use would make dictation feel sluggish.

**Checkpoint:** record 3 s of yourself saying "testing one two three", print the transcription to the console. If it's garbage → your resampling is wrong (see Phase 2 warning).

### Phase 4 — Global push-to-talk hotkey (`lib.rs`)

Tauri's global-shortcut plugin delivers separate **Pressed** and **Released** events — exactly the hold-to-talk behavior Wispr uses:

```rust
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| match event.state() {
                    ShortcutState::Pressed => {
                        // start recording + show overlay (emit event / call recorder)
                        let _ = app.emit("recording-started", ());
                        start_recording(app);
                    }
                    ShortcutState::Released => {
                        let _ = app.emit("recording-stopped", ());
                        // stop → transcribe → inject, on a background thread
                        finish_dictation(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            app.global_shortcut().register("ctrl+space")?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

Notes:
- Windows auto-repeats held keys → you'll receive repeated `Pressed` events while holding. Guard with an `is_recording` flag: ignore `Pressed` if already recording.
- Run transcribe+inject on `std::thread::spawn` (or `tauri::async_runtime`) — never block the event handler.
- `Ctrl+Space` conflicts with IntelliSense in some editors; make it configurable (Phase 6) and consider `Ctrl+Win` or `F9` as defaults. Changing the hotkey = `unregister` old + `register` new.

**Checkpoint:** hold hotkey with Notepad focused → console prints transcription on release.

### Phase 5 — Text injection (`inject.rs`)

Clipboard-paste is what Wispr and every serious dictation tool uses (per-character typing is slow and breaks on IMEs):

```rust
use arboard::Clipboard;
use enigo::{Enigo, Key, Direction, Keyboard, Settings};

pub fn inject_text(text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let saved = clipboard.get_text().ok();          // preserve user's clipboard

    clipboard.set_text(text).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50)); // let clipboard settle

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?;
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?;

    // restore clipboard after the paste lands
    std::thread::sleep(std::time::Duration::from_millis(150));
    if let Some(s) = saved { let _ = clipboard.set_text(s); }
    Ok(())
}
```

> ⚠️ If your own hotkey includes Ctrl (e.g. `Ctrl+Space`), the user's physical Ctrl may still be held when you paste. Either wait ~100 ms after Release before pasting, or pick a default hotkey without Ctrl.

**Checkpoint:** the full loop works — focus Notepad, hold hotkey, speak, release, text appears.
**🎉 This is the MVP moment. Everything after is polish.**

### Phase 6 — UI: settings window + overlay pill (React + Tailwind)

Two windows, declared in `tauri.conf.json`:

```json
"app": {
  "windows": [
    {
      "label": "main", "title": "FlowLite", "width": 720, "height": 520,
      "visible": false, "resizable": false
    },
    {
      "label": "overlay", "url": "/overlay", "width": 220, "height": 56,
      "transparent": true, "decorations": false, "alwaysOnTop": true,
      "skipTaskbar": true, "visible": false, "shadow": false, "focus": false
    }
  ]
}
```

**Overlay pill** (`Overlay.tsx`) — listens for backend events, shows a Wispr-style pill at the bottom-center of the screen:

```tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export default function Overlay() {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");

  useEffect(() => {
    const subs = [
      listen("recording-started", () => setState("rec")),
      listen("recording-stopped", () => setState("busy")),
      listen("dictation-done", () => setState("idle")),
    ];
    return () => { subs.forEach(s => s.then(un => un())); };
  }, []);

  if (state === "idle") return null;
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2 rounded-full bg-zinc-900/90 px-4 py-2 text-sm text-white shadow-lg">
        {state === "rec"
          ? <><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> Listening…</>
          : <><span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-zinc-500 border-t-white" /> Transcribing…</>}
      </div>
    </div>
  );
}
```

The Rust side shows/hides the overlay window on those same events, positioned bottom-center via `overlay_window.set_position(...)`.

**Settings window** (`App.tsx`) — a simple Tailwind card layout with:
- Hotkey recorder (an input that captures the next key combo pressed)
- Microphone dropdown (Rust command `list_input_devices()` via cpal)
- Model picker (tiny/base/small + download button with progress)
- "Start with Windows" toggle → calls the autostart plugin
- "Test dictation" area (a textarea to try it out)

Persist all settings with `tauri-plugin-store` (writes a JSON file in `%APPDATA%`); load them in Rust `setup()` before registering the hotkey.

### Phase 7 — Tray icon, autostart, background behavior

**Tray** (in `setup()`): menu with *Enabled ✓ / Settings / Quit*. Left-click opens settings. Closing the settings window should **hide** it, not exit (intercept `WindowEvent::CloseRequested`, call `window.hide()`).

**Autostart:**
```rust
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    Some(vec!["--minimized"]),
))
```
Expose enable/disable to the UI toggle. With `--minimized` the app boots straight to tray — the hotkey works but no window flashes at login.

**Single instance:** add `tauri-plugin-single-instance` so double-launching just focuses the existing settings window.

### Phase 8 — Build the .exe

```powershell
npm run tauri build
```

Output:
- `src-tauri/target/release/flowlite.exe` — the portable exe (~10–15 MB)
- `src-tauri/target/release/bundle/nsis/FlowLite_1.0.0_x64-setup.exe` — the installer

In `tauri.conf.json` set `productName`, `identifier` (e.g. `com.harshil.flowlite`), version, and icon (`npm run tauri icon path/to/icon.png` generates every size).

**Unsigned-exe note:** Windows SmartScreen will warn on first run ("More info → Run anyway"). Normal for personal apps; code-signing certificates cost money and are only worth it if you distribute publicly.

---

## 7. Performance Budget (what "lightweight" looks like)

| State | RAM | CPU |
|---|---|---|
| Idle in tray (model loaded, small.en) | ~400–500 MB* | ~0% |
| Recording | +5 MB | <1% |
| Transcribing a sentence | spike | 1 core for ~1 s |

\*If 500 MB idle bothers you: load the model lazily on first dictation, or use `base.en` (~200 MB). Wispr itself idles around 300–500 MB, so `small.en` resident is on par — with better privacy.

Latency target: **release key → text appears in under 1.5 s** for a spoken sentence on a mid-range laptop. If it's slower, drop to `base.en-q5_1` — still very usable accuracy.

---

## 8. Known Pitfalls Checklist

1. **Garbage transcriptions** → audio isn't 16 kHz mono f32. Fix resampling (Phase 2).
2. **Hotkey fires repeatedly while held** → Windows key auto-repeat; guard with `is_recording` flag.
3. **Paste does nothing** → user's Ctrl still physically held (hotkey contains Ctrl), or the 50 ms clipboard settle is too short on slow machines.
4. **Paste into elevated apps (admin terminals) fails** → Windows blocks input injection into higher-privilege processes. Either accept it or offer "run FlowLite as admin" as an option.
5. **First `cargo build` takes 5–10 min** → whisper.cpp compiling; one-time cost.
6. **Antivirus flags the exe** → common for unsigned exes that simulate keystrokes. Add an exclusion for your dev folder.
7. **Whisper hallucinates on silence** (produces "Thanks for watching!" etc.) → if the recording's peak amplitude is near zero, skip transcription entirely; also `set_suppress_blank(true)` helps.
8. **Blocking the shortcut handler** → transcription must run on a background thread or the whole hotkey system stalls.

---

## 9. Suggested Order of Work (realistic timeline)

| Session | Work | Outcome |
|---|---|---|
| 1 (~2 h) | Phase 0–1: scaffold, deps compile | Window opens |
| 2 (~2 h) | Phase 2–3: record + transcribe to console | Console STT works |
| 3 (~2 h) | Phase 4–5: hotkey + injection | **MVP: dictate anywhere** |
| 4 (~3 h) | Phase 6: settings UI + overlay pill | Feels like a product |
| 5 (~2 h) | Phase 7–8: tray, autostart, build exe | Ships |

---

## 10. V2 Ideas, Ranked by Effort

1. **Silence-skip + filler cleanup** (easy) — regex out "um/uh", skip near-silent recordings.
2. **Toggle mode** (easy) — tap once to start, tap again to stop, for long dictations.
3. **Custom dictionary** (easy) — user-defined find/replace applied post-transcription.
4. **History panel** (medium) — store last N transcriptions in the settings UI.
5. **AI polish / tones** (medium) — optional: send transcription to Claude API (`claude-haiku-4-5`) with a prompt like "rewrite as a professional email" before injecting. This is Wispr's paid differentiator, and with your own API key it costs fractions of a cent per use.
6. **GPU acceleration** (medium) — build whisper-rs with the `vulkan` feature for near-instant transcription on machines with a GPU.
7. **Streaming transcription** (hard) — show words as you speak, like Wispr does. Requires chunked inference; save this for last.
