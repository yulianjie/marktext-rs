//! Folder / workspace commands.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::app::{AppState, Workspace};
use crate::error::{AppError, AppResult};
use crate::filesystem::watcher;

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub size: u64,
    pub modified_ms: i64,
}

#[tauri::command]
pub async fn cmd_open_folder(app: AppHandle) -> AppResult<Option<PathBuf>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    let result = rx
        .await
        .map_err(|_| AppError::Other("dialog cancelled".into()))?;
    Ok(result.and_then(|p| p.into_path().ok()))
}

#[tauri::command]
pub async fn cmd_list_directory(path: PathBuf) -> AppResult<Vec<DirEntry>> {
    let mut entries = Vec::new();
    let mut read = tokio::fs::read_dir(&path).await?;
    while let Some(entry) = read.next_entry().await? {
        let meta = entry.metadata().await?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = meta.is_dir();
        let path = entry.path();
        let is_markdown = !is_dir
            && path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| matches!(s.to_ascii_lowercase().as_str(), "md" | "markdown" | "mkd" | "mdown" | "mdtxt"))
                .unwrap_or(false);
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        entries.push(DirEntry {
            name,
            path,
            is_dir,
            is_markdown,
            size: meta.len(),
            modified_ms,
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn cmd_watch_folder(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: PathBuf,
) -> AppResult<()> {
    let handle = watcher::spawn(app, path.clone())?;
    state.add_workspace(Workspace {
        root: path.clone(),
        watcher: handle,
    });
    state.push_recent_folder(path);
    Ok(())
}

#[tauri::command]
pub fn cmd_unwatch_folder(state: tauri::State<'_, AppState>, path: PathBuf) -> AppResult<()> {
    state.remove_workspace(&path);
    Ok(())
}
