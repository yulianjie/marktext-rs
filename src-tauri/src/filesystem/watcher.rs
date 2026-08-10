//! Folder watcher — replaces chokidar.
//!
//! Uses `notify-debouncer-full` to coalesce bursts of FS events (the chokidar
//! default behaviour) before forwarding them to the renderer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use parking_lot::{Mutex, RwLock};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppResult;
use crate::ipc::events::FileWatchEvent;

pub type Notifier = Arc<Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>>;
pub type WorkspaceEventTargets = Arc<RwLock<HashMap<String, PathBuf>>>;

pub struct WatcherHandle {
    pub root: PathBuf,
    pub debouncer: Notifier,
}

pub fn spawn(
    app: AppHandle,
    root: PathBuf,
    targets: WorkspaceEventTargets,
) -> AppResult<WatcherHandle> {
    let app_handle = app.clone();
    let event_root = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                for ev in events {
                    let Some(payload) = map_event(&ev.event) else {
                        continue;
                    };
                    // A canonical root can be shared by multiple editor
                    // windows, each of which may have opened it through a
                    // different renderer-facing spelling (for example a
                    // symlink or Windows verbatim path). Emit only to owners
                    // and translate the payload back to each owner's root.
                    let owners = targets.read().clone();
                    for (label, renderer_root) in owners {
                        let payload = remap_event(&payload, &event_root, &renderer_root);
                        if let Some(window) = app_handle.get_webview_window(&label) {
                            let _ = window.emit("mt://fs/change", payload);
                        }
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

fn remap_event(event: &FileWatchEvent, source_root: &Path, renderer_root: &Path) -> FileWatchEvent {
    let remap = |path: &Path| {
        relative_to_root(source_root, path)
            .map(|relative| renderer_root.join(relative))
            // Rename events can legitimately include one endpoint outside the
            // watched root. Keep that endpoint intact instead of inventing a
            // renderer-relative path for it.
            .unwrap_or_else(|| path.to_path_buf())
    };
    match event {
        FileWatchEvent::Created { path } => FileWatchEvent::Created { path: remap(path) },
        FileWatchEvent::Modified { path } => FileWatchEvent::Modified { path: remap(path) },
        FileWatchEvent::Removed { path } => FileWatchEvent::Removed { path: remap(path) },
        FileWatchEvent::Renamed { from, to } => FileWatchEvent::Renamed {
            from: remap(from),
            to: remap(to),
        },
    }
}

fn relative_to_root(root: &Path, path: &Path) -> Option<PathBuf> {
    if let Ok(relative) = path.strip_prefix(root) {
        return Some(relative.to_path_buf());
    }

    // `canonicalize` uses verbatim paths on Windows while some notify backends
    // return ordinary drive/UNC spellings. Compare whole components rather
    // than vulnerable string prefixes and rebuild the unmatched suffix.
    #[cfg(windows)]
    {
        fn components(path: &Path) -> Vec<String> {
            let mut value = path.to_string_lossy().replace('\\', "/");
            if let Some(rest) = value.strip_prefix("//?/UNC/") {
                value = format!("//{rest}");
            } else if let Some(rest) = value.strip_prefix("//?/") {
                value = rest.to_string();
            }
            value
                .split('/')
                .filter(|part| !part.is_empty() && *part != ".")
                .map(ToOwned::to_owned)
                .collect()
        }

        let root_components = components(root);
        let path_components = components(path);
        if root_components.len() > path_components.len()
            || !root_components
                .iter()
                .zip(&path_components)
                .all(|(left, right)| left.eq_ignore_ascii_case(right))
        {
            return None;
        }
        let mut relative = PathBuf::new();
        for component in &path_components[root_components.len()..] {
            relative.push(component);
        }
        Some(relative)
    }
    #[cfg(not(windows))]
    {
        None
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watcher_events_are_rebased_to_each_renderer_root() {
        let source = PathBuf::from("/canonical/notes");
        let renderer = PathBuf::from("/renderer/notes");
        let event = FileWatchEvent::Renamed {
            from: source.join("drafts").join("old.md"),
            to: source.join("drafts").join("new.md"),
        };

        assert!(matches!(
            remap_event(&event, &source, &renderer),
            FileWatchEvent::Renamed { from, to }
                if from == renderer.join("drafts").join("old.md")
                    && to == renderer.join("drafts").join("new.md")
        ));
    }

    #[test]
    fn rename_endpoint_outside_the_workspace_is_not_forged_under_renderer_root() {
        let source = PathBuf::from("/canonical/notes");
        let renderer = PathBuf::from("/renderer/notes");
        let outside = PathBuf::from("/canonical/outside.md");
        let event = FileWatchEvent::Renamed {
            from: source.join("inside.md"),
            to: outside.clone(),
        };

        assert!(matches!(
            remap_event(&event, &source, &renderer),
            FileWatchEvent::Renamed { from, to }
                if from == renderer.join("inside.md") && to == outside
        ));
    }

    #[test]
    fn relative_mapping_rejects_string_prefix_siblings() {
        assert_eq!(
            relative_to_root(
                Path::new("/canonical/notes"),
                Path::new("/canonical/notes-old/file.md"),
            ),
            None,
        );
    }

    #[cfg(windows)]
    #[test]
    fn relative_mapping_accepts_verbatim_and_regular_windows_spellings() {
        assert_eq!(
            relative_to_root(
                Path::new(r"\\?\C:\Users\Jack\Notes"),
                Path::new(r"c:\users\jack\notes\draft.md"),
            ),
            Some(PathBuf::from("draft.md")),
        );
    }
}
