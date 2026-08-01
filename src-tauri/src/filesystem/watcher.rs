//! Folder watcher — replaces chokidar.
//!
//! Uses `notify-debouncer-full` to coalesce bursts of FS events (the chokidar
//! default behaviour) before forwarding them to the renderer.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::ipc::events::FileWatchEvent;

pub type Notifier = Arc<Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>>;

pub struct WatcherHandle {
    pub root: PathBuf,
    pub debouncer: Notifier,
}

pub fn spawn(app: AppHandle, root: PathBuf) -> AppResult<WatcherHandle> {
    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                for ev in events {
                    let payload = map_event(&ev.event);
                    if let Some(payload) = payload {
                        let _ = app_handle.emit("mt://fs/change", payload);
                    }
                }
            }
            Err(errs) => {
                for err in errs {
                    tracing::warn!(?err, "watcher error");
                }
            }
        },
    )?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(WatcherHandle {
        root,
        debouncer: Arc::new(Mutex::new(Some(debouncer))),
    })
}

fn map_event(ev: &notify::Event) -> Option<FileWatchEvent> {
    use notify::EventKind::*;
    let path = ev.paths.first().cloned()?;
    let event = match ev.kind {
        Create(_) => FileWatchEvent::Created { path },
        Modify(notify::event::ModifyKind::Name(_)) => {
            if let Some(to) = ev.paths.get(1).cloned() {
                FileWatchEvent::Renamed { from: path, to }
            } else {
                FileWatchEvent::Modified { path }
            }
        }
        Modify(_) => FileWatchEvent::Modified { path },
        Remove(_) => FileWatchEvent::Removed { path },
        _ => return None,
    };
    Some(event)
}

#[allow(dead_code)]
pub fn stop(handle: WatcherHandle, _root: &Path) {
    let mut guard = handle.debouncer.lock();
    drop(guard.take());
}
