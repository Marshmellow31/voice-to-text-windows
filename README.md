# FlowLite 🎙️

**Talk instead of type — anywhere on Windows.**

FlowLite is a free, lightweight voice-to-text app. Hold a key, say what you want to write, let go — and your words are typed into whatever app you're using: a browser, VS Code, Slack, Word, Notepad, anywhere a cursor blinks.

It's inspired by apps like Wispr Flow, with one big difference: **everything runs on your own computer**. No account, no subscription, no word limits, and your voice never leaves your machine.

---

## How It Works (the simple version)

1. **Click into any text field** in any app — an email, a chat box, a document.
2. **Hold the hotkey** (default: `F9`). A small "● Listening…" pill appears at the bottom of your screen.
3. **Speak normally.** "Hey, just checking in about tomorrow's meeting."
4. **Release the key.** The pill switches to "Transcribing…" for about a second.
5. **Your words appear** in the text field, as if you had typed them.

That's the whole app. It sits quietly in your system tray and works in the background all day.

### Offline vs. online — what needs the internet?

| | Internet needed? |
|---|---|
| **Dictating (everyday use)** | ❌ No — transcription happens 100% on your CPU |
| **First-time model download** | ✅ Yes — one-time download of the speech model (31–182 MB) |
| **Everything else** | ❌ No — settings, hotkeys, the app itself are all local |

Once the speech model is downloaded, you can unplug from the internet forever and FlowLite keeps working. Nothing you say is ever sent anywhere — there are no servers, no analytics, no accounts.

### Why local matters

Cloud dictation apps put a meter on your words because *their* servers do the work. FlowLite runs the same class of speech-recognition technology (OpenAI's Whisper) directly on your PC, so there is nothing to meter. Unlimited use, total privacy, zero cost.

---

## Features

- 🎯 **Push-to-talk dictation** — hold `F9` (configurable), speak, release. Works in every app.
- 🔒 **100% private & offline** — audio is processed on your machine and immediately discarded.
- 🧠 **Three accuracy levels** — pick a speech model to match your PC:
  | Model | Download size | Best for |
  |---|---|---|
  | Tiny | 31 MB | Older/slower PCs, clear speech |
  | Base | 57 MB | Good balance |
  | **Small** ⭐ | 182 MB | Recommended — near cloud-level accuracy |
- 🖥️ **Settings window** — change the hotkey, pick your microphone, switch models, test dictation.
- 💊 **On-screen pill** — a tiny floating indicator shows when it's listening or transcribing, then disappears.
- 🧰 **System tray app** — closing the window hides it to the tray; it keeps listening for your hotkey.
- 🚀 **Start with Windows** — optional toggle; boots silently to the tray.
- 🤫 **Silence detection** — if you press the key but don't speak, nothing is typed (no garbage output).
- 🪶 **Lightweight** — ~10 MB app. It uses Windows' built-in browser engine instead of bundling one, unlike Electron apps that ship 150+ MB.
- 📋 **Clipboard-safe** — text is inserted via a quick paste, and whatever you had copied before is restored afterwards.

---

## Getting Started

1. Run the installer: `FlowLite_0.1.0_x64-setup.exe`
   *(Windows SmartScreen may warn about an unknown publisher — click "More info → Run anyway". That warning just means the app isn't code-signed, which costs money and only matters for public distribution.)*
2. FlowLite opens. In the **Speech Model** section, click **Download** next to "Small (182 MB)".
3. Wait for the "Model ready ✓" message (one-time step).
4. Click into any text field, **hold `F9`**, speak, release. Done.

> **Tip:** paste into admin-elevated windows (like an Administrator terminal) is blocked by Windows security. Everything else works.

---

## The Technical Stuff (in plain English)

### The four moving parts

Any dictation app is really four systems glued together. Here's what FlowLite uses for each:

| Job | How FlowLite does it |
|---|---|
| **1. Hearing the hotkey** even when the app is in the background | Tauri's `global-shortcut` plugin registers `F9` with Windows itself, so press/release events arrive no matter which app has focus. Key auto-repeat (Windows fires "pressed" repeatedly while a key is held) is filtered out. |
| **2. Recording your voice** | The `cpal` Rust library captures raw microphone audio. Whisper strictly requires 16,000 samples/second, mono — most mics record at 44,100 or 48,000 in stereo — so FlowLite downmixes and resamples the audio before transcription. Get this wrong and you get gibberish; it's the #1 pitfall of building one of these. |
| **3. Turning speech into text** | [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — a highly optimized C++ version of OpenAI's open-source Whisper model. FlowLite writes your recording to a temporary WAV file and runs the bundled `whisper-cli.exe` on it in a hidden window. A spoken sentence transcribes in roughly a second on a modern CPU. |
| **4. Typing the result** | Typing character-by-character is slow and fragile, so FlowLite does what professional dictation tools do: it puts the text on the clipboard, simulates `Ctrl+V`, then restores your original clipboard. Instant, and works in virtually every app. |

Supporting cast: a system-tray icon, the floating overlay pill, a settings window, optional autostart, and single-instance protection (launching it twice just focuses the existing window).

### The tech stack, and why

- **[Tauri v2](https://tauri.app)** (desktop shell) — like Electron, but instead of bundling an entire Chrome browser it uses **WebView2**, the browser engine already built into Windows 11. Result: a ~10 MB app instead of 150+ MB, and far less RAM.
- **React + TypeScript + Tailwind CSS** (the UI) — the settings window and overlay pill are a small web app rendered inside that WebView. Standard web tech, nothing exotic.
- **Rust** (the backend) — all the real work (hotkeys, audio, running Whisper, pasting) happens in native Rust code, which is fast and memory-safe. The UI and Rust talk over Tauri's built-in message bridge.
- **whisper.cpp as a bundled program, not a library** — FlowLite ships the official prebuilt `whisper-cli.exe` (v1.9.1) and runs it as a subprocess.
  *Why not link it as a native library?* We tried (via the `whisper-rs` bindings), and it repeatedly failed to build on a bleeding-edge MSVC/LLVM toolchain. Running the prebuilt CLI is the same engine with zero build fragility — the only cost is the model loading per dictation (~1 s), which is fine for sentence-length clips.
- **`hound`** writes the WAV file, **`arboard`** handles the clipboard, **`enigo`** simulates the paste keystroke.

### Where your data lives

| What | Where |
|---|---|
| Speech models | `%APPDATA%\com.harshil.flowlite\models\` (downloaded from Hugging Face, one-time) |
| Settings | `settings.json` in the same folder (hotkey, model choice, mic, autostart) |
| Your recordings | **Nowhere** — audio lives in memory, hits a temp WAV file only for the second Whisper needs it, and is deleted |

### One dictation, under the hood

```
hold F9 ──► Windows fires "pressed" ──► cpal starts mic stream ──► pill shows "Listening…"
   you speak (samples buffer in RAM)
release ──► "released" event ──► stream stops ──► pill shows "Transcribing…"
        └─► background thread:
              too quiet? ──► skip (prevents Whisper "hallucinating" text on silence)
              downmix to mono, resample to 16 kHz, write temp WAV
              run whisper-cli.exe -m <model> -f <wav> -nt   (hidden window)
              parse text from stdout
              save clipboard ► set text ► send Ctrl+V ► restore clipboard
pill disappears ──► your words are in the text field  (~1–1.5 s after release)
```

The transcription runs on a background thread so the hotkey listener never freezes — you can immediately start another dictation.

### Building from source

Prerequisites: Node.js 20+, Rust (stable, MSVC toolchain).

```powershell
cd flowlite
npm install
npm run tauri dev     # development, hot-reload
npm run tauri build   # production build
```

Build outputs:
- `src-tauri/target/release/flowlite.exe` — portable, no install needed
- `src-tauri/target/release/bundle/nsis/FlowLite_0.1.0_x64-setup.exe` — installer (recommended)
- `src-tauri/target/release/bundle/msi/FlowLite_0.1.0_x64_en-US.msi` — MSI alternative

The Whisper engine binaries live in `src-tauri/resources/whisper/` and are bundled automatically by the Tauri build.

---

## Roadmap ideas

- Toggle mode (tap to start / tap to stop) for long dictations
- Custom dictionary (auto-fix names and jargon Whisper gets wrong)
- Transcription history panel
- Optional AI cleanup pass (rewrite the raw transcript as a polished email/message)
- Multilingual models (current models are English-only)
- GPU acceleration for near-instant transcription

## License / credits

Personal project. Speech recognition by [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (MIT) running OpenAI's open-source [Whisper](https://github.com/openai/whisper) models, downloaded from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp).
