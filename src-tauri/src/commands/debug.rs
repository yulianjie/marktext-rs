//! Renderer-side debug bridge — forwards `console.error`/uncaught-exception
//! info to the Rust `tracing` log so they show up in the dev terminal.

use serde::Deserialize;

use crate::error::AppResult;

#[derive(Debug, Deserialize)]
pub struct LogEntry {
    pub level: String,
    pub message: String,
    pub stack: Option<String>,
    pub source: Option<String>,
}

#[tauri::command]
pub fn cmd_log(entry: LogEntry) -> AppResult<()> {
    let LogEntry {
        level,
        message,
        stack,
        source,
    } = entry;
    let source = source.unwrap_or_default();
    match level.as_str() {
        "error" => {
            tracing::error!(target: "renderer", source = %source, stack = ?stack, "{message}")
        }
        "warn" => tracing::warn!(target: "renderer", source = %source, "{message}"),
        "info" => tracing::info!(target: "renderer", source = %source, "{message}"),
        _ => tracing::debug!(target: "renderer", source = %source, "{message}"),
    }
    Ok(())
}
