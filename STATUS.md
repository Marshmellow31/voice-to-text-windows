# FlowLite — Build Status

_Last updated: 2026-07-12_

See [DOCUMENTATION.md](DOCUMENTATION.md) for the full plan.

## Current Phase: **1 — Rust deps / backend modules**

Project scaffolded at `flowlite/`.

## Prerequisites
| Tool | Status | Notes |
|---|---|---|
| Node.js | ✅ v24.18.0 | ok |
| npm | ✅ 11.6.2 | ok |
| Rust / cargo | ✅ 1.97.0 | at %USERPROFILE%\.cargo\bin |
| CMake | ✅ 4.4.0 | at C:\Program Files\CMake\bin (winget) |
| VS C++ Build Tools | ✅ (assumed) | validated by vanilla cargo build |
| WebView2 | ✅ (Win11 built-in) | ok |

## IMPORTANT: shell PATH note
My tool shells started before Rust/CMake installs, so **every** cargo/cmake command
must be prefixed with:
```
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Program Files\CMake\bin;$env:Path"
```

## Extra prerequisite discovered
- **LLVM 22.1.8** installed (winget `LLVM.LLVM`) — whisper-rs uses bindgen which needs
  `libclang.dll`. Build commands must also set:
  `$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"` and add `C:\Program Files\LLVM\bin` to PATH.

## Full build command (copy-paste)
```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Program Files\CMake\bin;C:\Program Files\LLVM\bin;$env:Path"
$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
cd "C:\Users\1080p\Desktop\personal projects\Voice to text App\flowlite"
npm run tauri dev     # or: npm run tauri build
```

## What's done
- [x] DOCUMENTATION.md written
- [x] Prerequisites installed & verified (Node, Rust, CMake, LLVM)
- [x] Phase 0: `flowlite/` scaffolded (Tauri v2 + React-TS), Tailwind v4 wired
- [x] Vanilla cargo build passed → MSVC toolchain confirmed
- [x] Phase 2: `audio.rs` — cpal capture, mono + 16kHz resample, silence detection
- [x] Phase 3: `stt.rs` — whisper-rs transcription
- [x] Phase 5: `inject.rs` — clipboard + Ctrl+V paste
- [x] `model.rs` — model list + one-time download with progress events
- [x] Phase 4+6+7: `lib.rs` — hotkey handler, settings persistence, tray, autostart,
      single-instance, overlay show/hide, all Tauri commands
- [x] Frontend: `App.tsx` (settings UI), `OverlayPill.tsx` + `overlay.html` (recording pill),
      two-window `tauri.conf.json`, capabilities/permissions
- [~] Full `cargo build` (whisper.cpp compiling, ~5-10 min) — task b1ue06d4h

## Build fix baked in (ROOT CAUSE FOUND)
whisper-rs bindgen was generating **glibc types** (`_G_fpos_t`, `_IO_FILE`) under MSVC.
Root cause: **`C:\MinGW\bin\gcc.exe` is on the system PATH** → clang auto-detects the
MinGW GCC install and pulls in its glibc-style headers.
Fix (in `src-tauri/.cargo/config.toml` `[env]`, applies to every cargo build):
```
BINDGEN_EXTRA_CLANG_ARGS = "--target=x86_64-pc-windows-msvc"
LIBCLANG_PATH = 'C:\Program Files\LLVM\bin'
```
For the regen build I also stripped MinGW out of PATH. Requires LLVM/libclang (installed).
(Dropped the earlier WHISPER_DONT_GENERATE_BINDINGS approach — it used the crate's
Linux-generated bindings, which are also glibc and equally broken on Windows.)

## Windows gotcha hit
- Filesystem is case-insensitive: `overlay.tsx` (entry) collided with `Overlay.tsx`.
  Renamed component to `OverlayPill.tsx`.

## ⭐ ARCHITECTURE PIVOT (current approach)
whisper-rs (native bindgen bindings) proved unbuildable on this bleeding-edge toolchain
(MSVC 14.51 / VS "2026" / LLVM 22): bindgen makes `whisper_full_params` opaque, and the
crate's shipped bindings are Linux/glibc-only. After 4 failed builds, **pivoted to running
the prebuilt whisper.cpp CLI as a subprocess.** Same engine, zero native-build fragility.

- Engine files bundled in `src-tauri/resources/whisper/` (whisper-cli.exe + whisper.dll +
  ggml*.dll), from whisper.cpp release **v1.9.1** `whisper-bin-x64.zip`. Verified runs.
- `stt.rs`: writes 16kHz mono WAV (via `hound`) → runs `whisper-cli.exe -m model -f wav -nt`
  with CREATE_NO_WINDOW → parses stdout. No persistent model load (CLI loads per call, ~1s).
- `Cargo.toml`: removed `whisper-rs`, added `hound`. No bindgen/libclang/cmake-C++ needed.
- `tauri.conf.json`: `bundle.resources = ["resources/whisper/*"]`.
- Cause of the glibc header pollution was **C:\MinGW\bin on PATH**. Deleted the obsolete
  `.cargo/config.toml` bindgen workaround.
- Model download (ggml-*.bin) still happens at runtime into %APPDATA%\<app>\models\.

## (historical) whisper-rs build saga — no longer relevant, kept for reference
whisper-rs-sys runs bindgen (clang) at build time and is fragile on Windows:
1. **glibc types error** (`_G_fpos_t` size overflow): bindgen picked up MinGW/glibc headers
   because clang saw gcc on PATH. Fixed by forcing MSVC target via
   `.cargo/config.toml` → `BINDGEN_EXTRA_CLANG_ARGS = "--target=x86_64-pc-windows-msvc"`.
2. **`whisper_full_params` opaque (size 1 vs 264)**: bindgen mis-generates the struct on
   this very new toolchain (MSVC 14.51 / VS "2026" / LLVM 22). INCLUDE headers were fine;
   bindgen itself is the problem. **FIX: skip bindgen** by setting
   `WHISPER_DONT_GENERATE_BINDINGS=1` — whisper-rs-sys then uses its shipped, known-good
   pre-generated bindings. No clang parsing needed.

Still build inside **vcvars64** (needed for the whisper.cpp C++ compile via cmake/MSVC):
   `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat`
   Build script: `scratchpad/build_whisper.bat` (vcvars + PATH + WHISPER_DONT_GENERATE_BINDINGS + cargo build).

## Canonical build (ALWAYS use vcvars for anything touching whisper-rs)
Run `scratchpad/build_whisper.bat`, OR in a shell:
```
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "PATH=%USERPROFILE%\.cargo\bin;C:\Program Files\CMake\bin;C:\Program Files\LLVM\bin;%PATH%"
cd flowlite\src-tauri  (or flowlite for npm run tauri build)
cargo build
```

## Current state (2026-07-12)
- `cargo check` passes clean (0 errors) ✅
- Production build running (task b6nntjjxl) — `npm run tauri build` via vcvars64
- All code changes verified by cargo check before the release build started

## Production build output (when complete)
- `src-tauri/target/release/FlowLite.exe` — portable exe
- `src-tauri/target/release/bundle/nsis/FlowLite_0.1.0_x64-setup.exe` — installer

## ✅ SHIPPED — build outputs
| File | Size |
|---|---|
| `target/release/flowlite.exe` | 10 MB (portable, runs without installing) |
| `target/release/bundle/nsis/FlowLite_0.1.0_x64-setup.exe` | 4 MB NSIS installer |
| `target/release/bundle/msi/FlowLite_0.1.0_x64_en-US.msi` | 7 MB MSI installer |

The NSIS `.exe` installer is the one to use/share. It handles install/uninstall via Windows Add/Remove Programs.

## First-run steps (user)
1. Run `FlowLite_0.1.0_x64-setup.exe`
2. App opens — click **Download** next to "Small (182 MB)" in the Speech Model section
3. Wait for download to finish ("Model ready ✓" toast appears)
4. Click in any text field in any app, hold **F9**, speak, release → text appears

## To rebuild
Run `scratchpad/build_prod.bat` (handles vcvars64 environment automatically).

## Phase checklist (from DOCUMENTATION.md §6)
- [ ] Phase 0 — Scaffold Tauri + React + Tailwind
- [ ] Phase 1 — Rust dependencies compile
- [ ] Phase 2 — Audio capture (16kHz mono)
- [ ] Phase 3 — Whisper transcription to console
- [ ] Phase 4 — Global push-to-talk hotkey
- [ ] Phase 5 — Text injection (clipboard paste) ← MVP
- [ ] Phase 6 — Settings UI + overlay pill
- [ ] Phase 7 — Tray, autostart, single-instance
- [ ] Phase 8 — Build .exe installer

## Blockers
- Rust and CMake must be installed manually (interactive installers; cannot be automated here).
