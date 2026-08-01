//! Folder / workspace commands.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::app::{AppState, Workspace};
use crate::error::{AppError, AppResult};
use crate::filesystem::watcher;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub size: u64,
    pub modified_ms: i64,
    pub created_ms: i64,
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
                .map(|s| {
                    matches!(
                        s.to_ascii_lowercase().as_str(),
                        "md" | "markdown" | "mkd" | "mdown" | "mdtxt"
                    )
                })
                .unwrap_or(false);
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        // Birth time is not available on every filesystem. Falling back to
        // modified time keeps created-sort deterministic on those platforms.
        let created_ms = meta
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(modified_ms);
        entries.push(DirEntry {
            name,
            path,
            is_dir,
            is_markdown,
            size: meta.len(),
            modified_ms,
            created_ms,
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::DirEntry;

    #[test]
    fn directory_entry_serializes_camel_case_timestamps() {
        let value = serde_json::to_value(DirEntry {
            name: "note.md".into(),
            path: "note.md".into(),
            is_dir: false,
            is_markdown: true,
            size: 42,
            modified_ms: 10,
            created_ms: 5,
        })
        .unwrap();
        assert_eq!(value["isDir"], json!(false));
        assert_eq!(value["isMarkdown"], json!(true));
        assert_eq!(value["modifiedMs"], json!(10));
        assert_eq!(value["createdMs"], json!(5));
        assert!(value.get("modified_ms").is_none());
    }
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
