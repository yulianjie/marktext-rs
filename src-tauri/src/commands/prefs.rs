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
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State};

use crate::app::AppState;
use crate::error::{AppError, AppResult};
use crate::preferences::schema;
use crate::preferences::store;

// Preserve the same total order for disk commits and their corresponding
// events. This is deliberately separate from the store's internal mutex:
// synchronous menu listeners may read the store while `emit` is in progress.
static WRITE_TRANSACTION: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

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
}
