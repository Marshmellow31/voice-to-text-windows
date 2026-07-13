//! Inject transcribed text into whatever app has focus, via clipboard + Ctrl+V.

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::time::Duration;

/// Paste `text` into the focused window, preserving the user's clipboard.
pub fn inject_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }

    // Wait for any modifier keys from the hotkey to physically release.
    // Without this, a Ctrl-based hotkey leaves Ctrl held → paste fires as Ctrl+Ctrl+V.
    std::thread::sleep(Duration::from_millis(120));

    let mut clipboard = Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    let saved = clipboard.get_text().ok();

    clipboard
        .set_text(text.to_string())
        .map_err(|e| format!("set clipboard: {e}"))?;
    std::thread::sleep(Duration::from_millis(50)); // let clipboard settle

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {e}"))?;

    // Explicitly release Ctrl/Shift/Alt in case they're still held from the hotkey.
    let _ = enigo.key(Key::Control, Direction::Release);
    let _ = enigo.key(Key::Shift, Direction::Release);
    let _ = enigo.key(Key::Alt, Direction::Release);

    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("ctrl down: {e}"))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("v: {e}"))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("ctrl up: {e}"))?;

    // Restore the previous clipboard once the paste has landed.
    std::thread::sleep(Duration::from_millis(160));
    if let Some(prev) = saved {
        let _ = clipboard.set_text(prev);
    }
    Ok(())
}
