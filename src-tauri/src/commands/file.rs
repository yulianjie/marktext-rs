//! File-level commands: open/read/save/rename/trash for individual `.md` files.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};
use crate::filesystem::markdown::{self, LoadedDocument};

#[derive(Debug, Deserialize)]
pub struct SaveOptions {
    pub encoding: Option<String>,
    pub line_ending: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveAsResult {
    pub path: PathBuf,
}

#[tauri::command]
pub async fn cmd_read_markdown(path: PathBuf) -> AppResult<LoadedDocument> {
    markdown::read_markdown(path).await
}

#[tauri::command]
pub async fn cmd_save_markdown(
    path: PathBuf,
    markdown: String,
    options: Option<SaveOptions>,
) -> AppResult<()> {
    let opts = options.unwrap_or(SaveOptions {
        encoding: None,
        line_ending: None,
    });
    let encoding = opts.encoding.as_deref().unwrap_or("utf-8");
    let line_ending = opts.line_ending.as_deref().unwrap_or("lf");
    crate::filesystem::markdown::write_markdown(path, &markdown, encoding, line_ending).await
}

#[tauri::command]
pub async fn cmd_open_files(app: AppHandle) -> AppResult<Vec<PathBuf>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mkd", "mdown", "mdtxt"])
        .pick_files(move |paths| {
            let _ = tx.send(paths);
        });
    let result = rx
        .await
        .map_err(|_| AppError::Other("dialog cancelled".into()))?;
    Ok(result
        .map(|paths| {
            paths
                .into_iter()
                .filter_map(|p| p.into_path().ok())
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub async fn cmd_save_as_dialog(
    app: AppHandle,
    default_name: Option<String>,
    default_dir: Option<PathBuf>,
) -> AppResult<Option<PathBuf>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(name) = default_name {
        builder = builder.set_file_name(&name);
    }
    if let Some(dir) = default_dir {
        builder = builder.set_directory(dir);
    }
    builder
        .add_filter("Markdown", &["md"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let result = rx
        .await
        .map_err(|_| AppError::Other("dialog cancelled".into()))?;
    Ok(result.and_then(|p| p.into_path().ok()))
}

#[tauri::command]
pub async fn cmd_rename_file(from: PathBuf, to: PathBuf) -> AppResult<()> {
    tokio::fs::rename(from, to).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_trash_file(path: PathBuf) -> AppResult<()> {
    tokio::task::spawn_blocking(move || trash::delete(&path))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}
