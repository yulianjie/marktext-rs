//! Top-level application state and startup hooks.
//!
//! Equivalent to the original `marktext/src/main/app/index.js` `App` class —
//! owns the recent-documents list, file watchers, and any other long-lived
//! state that outlives a single command invocation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::{App, Emitter, Manager};

use crate::error::AppResult;
use crate::filesystem::watcher::WatcherHandle;

/// Long-lived state shared across all command handlers via [`tauri::State`].
#[derive(Default)]
pub struct AppState {
    inner: Arc<RwLock<AppStateInner>>,
}

#[derive(Default)]
struct AppStateInner {
    /// Workspaces (folders) currently opened in the renderer, keyed by path.
    workspaces: HashMap<PathBuf, Workspace>,

    /// Recent files (most-recent first), capped to ~20 entries.
    recent_files: Vec<PathBuf>,

    /// Recent folders (most-recent first), capped to ~20 entries.
    recent_folders: Vec<PathBuf>,
}

pub struct Workspace {
    pub root: PathBuf,
    pub watcher: WatcherHandle,
}

impl AppState {
    pub fn push_recent_file(&self, path: PathBuf) {
        let mut inner = self.inner.write();
        inner.recent_files.retain(|p| p != &path);
        inner.recent_files.insert(0, path);
        inner.recent_files.truncate(20);
    }

    pub fn push_recent_folder(&self, path: PathBuf) {
        let mut inner = self.inner.write();
        inner.recent_folders.retain(|p| p != &path);
        inner.recent_folders.insert(0, path);
        inner.recent_folders.truncate(20);
    }

    pub fn recent_files(&self) -> Vec<PathBuf> {
        self.inner.read().recent_files.clone()
    }

    pub fn recent_folders(&self) -> Vec<PathBuf> {
        self.inner.read().recent_folders.clone()
    }

    pub fn add_workspace(&self, ws: Workspace) {
        self.inner.write().workspaces.insert(ws.root.clone(), ws);
    }

    pub fn remove_workspace(&self, root: &std::path::Path) -> Option<Workspace> {
        self.inner.write().workspaces.remove(root)
    }
}

/// Called once on Tauri `setup`. Inspects `std::env::args` for any positional
/// file arguments and, after the main webview is up, emits an
/// `mt://window/open-file` event for each. This is also the path
/// file-association launches take on Windows / Linux (the OS hands the path
/// in as argv[1]).
pub fn on_startup(app: &mut App) -> AppResult<()> {
    tracing::info!("MarkText starting up");

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let files: Vec<PathBuf> = argv
        .into_iter()
        .filter(|a| !a.starts_with("--") && !a.starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.exists() && p.is_file())
        .collect();

    if files.is_empty() {
        return Ok(());
    }

    // The webview hasn't fully initialised yet at this point; queue the
    // opens for after `WebviewWindow::on_webview_ready` fires. Tauri 2's
    // `webview_windows()` already returns the main window, but emitting now
    // races the renderer's listener install — so spawn a slight delay.
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        // Give the renderer a generous window to install listeners. 250ms is
        // empirically enough on cold starts; the user-visible latency is
        // dominated by webview boot anyway.
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        for file in files {
            tracing::info!(?file, "forwarding file-association launch to renderer");
            if let Some(win) = handle.get_webview_window("main") {
                let _ = win.emit("mt://window/open-file", serde_json::json!({ "path": file }));
            } else {
                let _ = handle.emit("mt://window/open-file", serde_json::json!({ "path": file }));
            }
        }
    });

    Ok(())
}
