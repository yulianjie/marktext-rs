//! Preference commands backed by the store plugin's in-memory cache and this
//! application's validated, atomic persistence layer.
//!
//! Every successful write broadcasts an `mt://prefs/changed` (or
//! `mt://userdata/changed`) event with the patch payload so all windows
//! can reactively sync their stores. Without this, the Preferences window
//! would update on disk but the editor window's Pinia store would stay stale
//! until next reload.

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::app::AppState;
use crate::error::{AppError, AppResult};
use crate::preferences::schema;
use crate::preferences::store;

// Preserve the same total order for disk commits and their corresponding
// events. This is deliberately separate from the store's internal mutex:
// synchronous menu listeners may read the store while `emit` is in progress.
static WRITE_TRANSACTION: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const EDITOR_SESSION_KEY: &str = "editorSession";
const EDITOR_SESSION_VERSION: u32 = 1;
const MAX_SESSION_TABS: usize = 100;
const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_FILENAME_BYTES: usize = 1024;
const MAX_CURSOR_BYTES: usize = 64 * 1024;
const MAX_DRAFT_BYTES: usize = 4 * 1024 * 1024;
const MAX_TOTAL_DRAFT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSession {
    version: u32,
    clean_shutdown: bool,
    timestamp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_tab_index: Option<usize>,
    tabs: Vec<EditorSessionTab>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditorSessionTab {
    dirty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    markdown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_saved_markdown: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    encoding: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bom: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    line_ending: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    trim_trailing_newline: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cursor: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_selection: Option<Value>,
    source_mode: bool,
}

fn ensure_main_session_owner(window: &WebviewWindow) -> AppResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::InvalidArgument(
            "only the main editor window may manage the default editor session".into(),
        ))
    }
}

fn validate_non_empty_string(value: &str, field: &str, max: usize) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidArgument(format!(
            "editor session {field} must not be empty"
        )));
    }
    if value.len() > max {
        return Err(AppError::InvalidArgument(format!(
            "editor session {field} exceeds {max} bytes"
        )));
    }
    Ok(())
}

fn validate_compact_json(value: &Option<Value>, field: &str) -> AppResult<()> {
    if let Some(value) = value {
        let bytes = serde_json::to_vec(value)?;
        if bytes.len() > MAX_CURSOR_BYTES {
            return Err(AppError::InvalidArgument(format!(
                "editor session {field} exceeds {MAX_CURSOR_BYTES} bytes"
            )));
        }
    }
    Ok(())
}

fn validate_editor_session(session: &EditorSession) -> AppResult<()> {
    if session.version != EDITOR_SESSION_VERSION {
        return Err(AppError::InvalidArgument(format!(
            "unsupported editor session version {}; expected {EDITOR_SESSION_VERSION}",
            session.version
        )));
    }
    if session.tabs.len() > MAX_SESSION_TABS {
        return Err(AppError::InvalidArgument(format!(
            "editor session contains too many tabs (maximum {MAX_SESSION_TABS})"
        )));
    }
    if session
        .active_tab_index
        .is_some_and(|index| index >= session.tabs.len())
    {
        return Err(AppError::InvalidArgument(
            "editor session activeTabIndex is outside tabs".into(),
        ));
    }
    if let Some(path) = &session.workspace_path {
        validate_non_empty_string(path, "workspacePath", MAX_PATH_BYTES)?;
    }

    let mut total_draft_bytes = 0usize;
    for (index, tab) in session.tabs.iter().enumerate() {
        if let Some(path) = &tab.path {
            validate_non_empty_string(path, &format!("tabs[{index}].path"), MAX_PATH_BYTES)?;
        }
        validate_compact_json(&tab.cursor, &format!("tabs[{index}].cursor"))?;
        validate_compact_json(
            &tab.source_selection,
            &format!("tabs[{index}].sourceSelection"),
        )?;

        if !tab.dirty {
            if tab.path.is_none() {
                return Err(AppError::InvalidArgument(format!(
                    "clean editor session tabs[{index}] requires path"
                )));
            }
            if tab.filename.is_some()
                || tab.markdown.is_some()
                || tab.last_saved_markdown.is_some()
                || tab.encoding.is_some()
                || tab.bom.is_some()
                || tab.line_ending.is_some()
                || tab.trim_trailing_newline.is_some()
            {
                return Err(AppError::InvalidArgument(format!(
                    "clean editor session tabs[{index}] must not persist document contents"
                )));
            }
            continue;
        }

        let filename = tab.filename.as_deref().ok_or_else(|| {
            AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] requires filename"
            ))
        })?;
        validate_non_empty_string(
            filename,
            &format!("tabs[{index}].filename"),
            MAX_FILENAME_BYTES,
        )?;
        let markdown = tab.markdown.as_ref().ok_or_else(|| {
            AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] requires markdown"
            ))
        })?;
        let baseline = tab.last_saved_markdown.as_ref().ok_or_else(|| {
            AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] requires lastSavedMarkdown"
            ))
        })?;
        let draft_bytes = markdown.len().saturating_add(baseline.len());
        if draft_bytes > MAX_DRAFT_BYTES {
            return Err(AppError::InvalidArgument(format!(
                "editor session tabs[{index}] draft exceeds {MAX_DRAFT_BYTES} bytes"
            )));
        }
        total_draft_bytes = total_draft_bytes.saturating_add(draft_bytes);
        let encoding = tab.encoding.as_deref().ok_or_else(|| {
            AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] requires encoding"
            ))
        })?;
        validate_non_empty_string(encoding, &format!("tabs[{index}].encoding"), 64)?;
        if tab.bom.is_none() {
            return Err(AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] requires bom"
            )));
        }
        if !matches!(tab.line_ending.as_deref(), Some("lf" | "crlf")) {
            return Err(AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] has invalid lineEnding"
            )));
        }
        if tab.trim_trailing_newline.is_some_and(|value| value > 3) {
            return Err(AppError::InvalidArgument(format!(
                "dirty editor session tabs[{index}] has invalid trimTrailingNewline"
            )));
        }
    }
    if session.clean_shutdown && session.tabs.iter().any(|tab| tab.dirty) {
        return Err(AppError::InvalidArgument(
            "a clean-shutdown editor session must not contain dirty drafts".into(),
        ));
    }
    if total_draft_bytes > MAX_TOTAL_DRAFT_BYTES {
        return Err(AppError::InvalidArgument(format!(
            "editor session total draft data exceeds {MAX_TOTAL_DRAFT_BYTES} bytes"
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_get_preferences(app: AppHandle) -> AppResult<Value> {
    store::get_all(&app)
}

#[tauri::command]
pub fn cmd_get_preference(app: AppHandle, key: String) -> AppResult<Option<Value>> {
    store::get(&app, &key)
}

#[tauri::command]
pub fn cmd_set_preference(app: AppHandle, key: String, value: Value) -> AppResult<()> {
    let _transaction = WRITE_TRANSACTION.lock();
    store::set(&app, &key, value.clone())?;
    let mut patch = Map::new();
    patch.insert(key, value);
    emit_patch(&app, "mt://prefs/changed", &patch);
    Ok(())
}

#[tauri::command]
pub fn cmd_set_preferences(app: AppHandle, patch: Map<String, Value>) -> AppResult<()> {
    let _transaction = WRITE_TRANSACTION.lock();
    store::set_many(&app, patch.clone())?;
    emit_patch(&app, "mt://prefs/changed", &patch);
    Ok(())
}

#[tauri::command]
pub fn cmd_push_recent(app: AppHandle, key: String, path: String) -> AppResult<Vec<String>> {
    if !matches!(key.as_str(), "recentFiles" | "recentFolders") {
        return Err(AppError::InvalidArgument(format!(
            "unsupported recent-list key: {key}"
        )));
    }
    if path.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "recent path must not be empty".into(),
        ));
    }

    let _transaction = WRITE_TRANSACTION.lock();
    let current = store::get(&app, &key)?
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect();
    let recent = update_recent_list(current, path);
    let value = serde_json::to_value(&recent)?;
    store::set(&app, &key, value.clone())?;
    let mut patch = Map::new();
    patch.insert(key, value);
    emit_patch(&app, "mt://prefs/changed", &patch);
    Ok(recent)
}

fn update_recent_list(mut current: Vec<String>, path: String) -> Vec<String> {
    current.retain(|value| value != &path);
    current.insert(0, path);
    current.truncate(20);
    current
}

#[tauri::command]
pub fn cmd_get_user_data(app: AppHandle, state: State<'_, AppState>) -> AppResult<Value> {
    let _transaction = WRITE_TRANSACTION.lock();
    // One-time migration: remove any token written by an older version and
    // retain it only in process memory for the remainder of this session.
    if let Some(Value::String(token)) = store::remove_user_data_key(&app, "githubToken")? {
        if state.github_token().is_none() {
            state.set_github_token(token);
        }
    }

    let mut user_data = store::get_user_data(&app)?;
    if let Some(token) = state.github_token() {
        user_data.insert("githubToken".into(), Value::String(token));
    }
    Ok(Value::Object(user_data))
}

#[tauri::command]
pub fn cmd_set_user_data(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: Map<String, Value>,
) -> AppResult<()> {
    let _transaction = WRITE_TRANSACTION.lock();
    schema::validate_user_data_patch(&patch)?;
    let broadcast_patch = patch.clone();

    apply_user_data_transaction(
        patch,
        || {
            // Ensure legacy plaintext is gone before accepting a new session
            // secret. Failure leaves the existing in-memory token unchanged.
            store::remove_user_data_key(&app, "githubToken")?;
            Ok(())
        },
        |persisted_patch| store::merge_user_data(&app, persisted_patch),
        |token| state.set_github_token(token),
    )?;
    emit_patch(&app, "mt://userdata/changed", &broadcast_patch);
    Ok(())
}

/// Read the main editor's crash/session snapshot without broadcasting it as
/// ordinary preference state to every open window.
#[tauri::command]
pub fn cmd_get_editor_session(
    app: AppHandle,
    window: WebviewWindow,
) -> AppResult<Option<EditorSession>> {
    ensure_main_session_owner(&window)?;
    let _transaction = WRITE_TRANSACTION.lock();
    let Some(raw) = store::get_user_data_key(&app, EDITOR_SESSION_KEY)? else {
        return Ok(None);
    };
    let session: EditorSession = serde_json::from_value(raw).map_err(|error| {
        AppError::InvalidArgument(format!("invalid persisted editor session: {error}"))
    })?;
    validate_editor_session(&session)?;
    Ok(Some(session))
}

/// Atomically replace the main editor session. Every call is schema and size
/// validated before the preference file is touched.
#[tauri::command]
pub fn cmd_set_editor_session(
    app: AppHandle,
    window: WebviewWindow,
    session: EditorSession,
) -> AppResult<()> {
    ensure_main_session_owner(&window)?;
    validate_editor_session(&session)?;
    let _transaction = WRITE_TRANSACTION.lock();
    store::set_user_data_key(&app, EDITOR_SESSION_KEY, serde_json::to_value(session)?)
}

#[tauri::command]
pub fn cmd_clear_editor_session(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    ensure_main_session_owner(&window)?;
    let _transaction = WRITE_TRANSACTION.lock();
    store::remove_user_data_key(&app, EDITOR_SESSION_KEY)?;
    Ok(())
}

fn apply_user_data_transaction(
    mut patch: Map<String, Value>,
    remove_legacy_secret: impl FnOnce() -> AppResult<()>,
    persist_non_secret: impl FnOnce(Map<String, Value>) -> AppResult<()>,
    commit_secret: impl FnOnce(String),
) -> AppResult<()> {
    let token = match patch.remove("githubToken") {
        Some(Value::String(token)) => Some(token),
        _ => None,
    };

    if token.is_some() {
        remove_legacy_secret()?;
    }
    persist_non_secret(patch)?;
    if let Some(token) = token {
        commit_secret(token);
    }
    Ok(())
}

fn emit_patch(app: &AppHandle, event: &str, patch: &Map<String, Value>) {
    if let Err(error) = app.emit(event, serde_json::json!({ "patch": patch })) {
        tracing::warn!(%error, %event, "preference was saved but change event could not be emitted");
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use serde_json::json;

    use crate::error::AppError;

    use super::*;

    #[test]
    fn secret_is_not_committed_when_non_secret_persistence_fails() {
        let events = RefCell::new(Vec::new());
        let patch = json!({ "githubToken": "new-secret", "currentUploader": "github" })
            .as_object()
            .unwrap()
            .clone();

        let result = apply_user_data_transaction(
            patch,
            || {
                events.borrow_mut().push("remove-legacy");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("persist");
                Err(AppError::Other("simulated write failure".into()))
            },
            |_| events.borrow_mut().push("commit-secret"),
        );

        assert!(result.is_err());
        assert_eq!(*events.borrow(), vec!["remove-legacy", "persist"]);
    }

    #[test]
    fn recent_list_update_is_deduplicated_and_bounded() {
        let current = (0..24).map(|index| format!("note-{index}.md")).collect();
        let updated = update_recent_list(current, "note-5.md".into());
        assert_eq!(updated.first().map(String::as_str), Some("note-5.md"));
        assert_eq!(updated.len(), 20);
        assert_eq!(
            updated.iter().filter(|value| *value == "note-5.md").count(),
            1
        );
    }

    fn valid_session() -> EditorSession {
        EditorSession {
            version: EDITOR_SESSION_VERSION,
            clean_shutdown: false,
            timestamp: 123,
            workspace_path: Some("C:\\notes".into()),
            active_tab_index: Some(1),
            tabs: vec![
                EditorSessionTab {
                    dirty: false,
                    path: Some("C:\\notes\\clean.md".into()),
                    filename: None,
                    markdown: None,
                    last_saved_markdown: None,
                    encoding: None,
                    bom: None,
                    line_ending: None,
                    trim_trailing_newline: None,
                    cursor: None,
                    source_selection: None,
                    source_mode: false,
                },
                EditorSessionTab {
                    dirty: true,
                    path: Some("C:\\notes\\dirty.md".into()),
                    filename: Some("dirty.md".into()),
                    markdown: Some("draft".into()),
                    last_saved_markdown: Some("disk".into()),
                    encoding: Some("utf8".into()),
                    bom: Some(false),
                    line_ending: Some("lf".into()),
                    trim_trailing_newline: Some(1),
                    cursor: Some(json!({ "anchor": 2 })),
                    source_selection: Some(
                        json!({ "ranges": [{ "anchor": 2, "head": 2 }], "main": 0 }),
                    ),
                    source_mode: true,
                },
            ],
        }
    }

    #[test]
    fn editor_session_accepts_clean_and_dirty_tabs() {
        assert!(validate_editor_session(&valid_session()).is_ok());
    }

    #[test]
    fn editor_session_accepts_legacy_dirty_tab_without_trailing_policy() {
        let mut value = serde_json::to_value(valid_session()).unwrap();
        value["tabs"][1]
            .as_object_mut()
            .unwrap()
            .remove("trimTrailingNewline");
        let restored: EditorSession = serde_json::from_value(value).unwrap();
        assert_eq!(restored.tabs[1].trim_trailing_newline, None);
        assert!(validate_editor_session(&restored).is_ok());
    }

    #[test]
    fn editor_session_rejects_invalid_trailing_policy() {
        let mut session = valid_session();
        session.tabs[1].trim_trailing_newline = Some(4);
        assert!(validate_editor_session(&session)
            .unwrap_err()
            .to_string()
            .contains("invalid trimTrailingNewline"));
    }

    #[test]
    fn editor_session_rejects_old_version_and_invalid_active_index() {
        let mut session = valid_session();
        session.version = 0;
        assert!(validate_editor_session(&session)
            .unwrap_err()
            .to_string()
            .contains("unsupported editor session version"));

        let mut session = valid_session();
        session.active_tab_index = Some(session.tabs.len());
        assert!(validate_editor_session(&session).is_err());
    }

    #[test]
    fn editor_session_rejects_contents_on_clean_tab() {
        let mut session = valid_session();
        session.tabs[0].markdown = Some("must not be copied".into());
        assert!(validate_editor_session(&session).is_err());
    }

    #[test]
    fn editor_session_rejects_oversized_single_and_total_drafts() {
        let mut session = valid_session();
        session.tabs[1].markdown = Some("x".repeat(MAX_DRAFT_BYTES + 1));
        assert!(validate_editor_session(&session).is_err());

        let per_tab = MAX_DRAFT_BYTES / 2;
        let mut session = valid_session();
        session.tabs = (0..9)
            .map(|index| EditorSessionTab {
                dirty: true,
                path: None,
                filename: Some(format!("Untitled-{index}")),
                markdown: Some("x".repeat(per_tab)),
                last_saved_markdown: Some(String::new()),
                encoding: Some("utf8".into()),
                bom: Some(false),
                line_ending: Some("lf".into()),
                trim_trailing_newline: Some(3),
                cursor: None,
                source_selection: None,
                source_mode: false,
            })
            .collect();
        session.active_tab_index = None;
        assert!(validate_editor_session(&session).is_err());
    }
}
