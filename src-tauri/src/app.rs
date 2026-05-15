//! Top-level application state and startup hooks.
//!
//! Equivalent to the original `marktext/src/main/app/index.js` `App` class —
//! owns the recent-documents list, file watchers, and any other long-lived
//! state that outlives a single command invocation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::App;

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

/// Called once on Tauri `setup`. Handles CLI args, file associations, and any
/// other "open this file/folder on launch" handoff to the renderer.
pub fn on_startup(_app: &mut App) -> AppResult<()> {
    // TODO: parse CLI args (see crate::cli) and emit `mt://open-on-startup`.
    tracing::info!("MarkText starting up");
    Ok(())
}
