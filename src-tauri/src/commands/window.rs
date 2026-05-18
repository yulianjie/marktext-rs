//! Window-level commands.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn cmd_new_window(app: AppHandle, label: Option<String>) -> AppResult<()> {
    let label = label.unwrap_or_else(|| format!("editor-{}", uuid::Uuid::new_v4()));
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("MarkText")
        .inner_size(1200.0, 900.0)
        .center()
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_close_window(app: AppHandle, label: String) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_set_always_on_top(app: AppHandle, label: String, on_top: bool) -> AppResult<()> {
    if let Some(win) = app.get_webview_window(&label) {
        win.set_always_on_top(on_top)
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_open_settings(app: AppHandle) -> AppResult<()> {
    let label = "settings";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html#/preferences".into()))
        .title("Preferences")
        .inner_size(900.0, 700.0)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}
