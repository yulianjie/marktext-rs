//! Export commands — HTML / PDF.
//!
//! HTML export is a thin file-write wrapper; the renderer produces the HTML
//! string. PDF export uses the webview's built-in `print_to_pdf` API.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn cmd_export_html(path: PathBuf, html: String) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    tokio::fs::write(path, html).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_export_pdf(
    app: AppHandle,
    window_label: String,
    _path: PathBuf,
) -> AppResult<()> {
    // TODO: Tauri 2 doesn't expose webview `print_to_pdf` directly; we'll
    // either drive it via a JS helper that returns a base64 PDF or fall back
    // to a Pandoc subprocess. For now this is a stub so `commands::all()`
    // compiles end-to-end.
    let _win = app
        .get_webview_window(&window_label)
        .ok_or_else(|| AppError::NotFound(format!("window {window_label}")))?;
    Err(AppError::Other("PDF export not implemented yet".into()))
}
