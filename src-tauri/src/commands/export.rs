//! Export commands — HTML / PDF.
//!
//! HTML export is a thin file-write wrapper; the renderer produces the HTML
//! string. PDF export is delivered by emitting a request to the renderer to
//! call `window.print()`. The OS print dialog supports "Save as PDF" on every
//! supported platform — there is no Tauri-native `printToPDF` equivalent,
//! and the renderer already has all the styling context needed.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn cmd_export_html(path: PathBuf, html: String) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    tokio::fs::write(path, html).await?;
    Ok(())
}

/// Triggers a print dialog in the target window. The renderer is responsible
/// for actually invoking `window.print()` after styling itself for print —
/// we just nudge it via an event. Keeps Rust ignorant of webview print
/// internals (which Tauri 2 does not expose programmatically).
#[tauri::command]
pub async fn cmd_export_pdf(app: AppHandle, window_label: String) -> AppResult<()> {
    let win = app
        .get_webview_window(&window_label)
        .ok_or_else(|| AppError::NotFound(format!("window {window_label}")))?;
    win.emit("mt://export/print", ())
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}
