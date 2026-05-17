//! Preference commands — read/write through `tauri-plugin-store`.
//!
//! Every successful write broadcasts an `mt://prefs/changed` (or
//! `mt://userdata/changed`) event with the patch payload so all windows
//! can reactively sync their stores. Without this, the Preferences window
//! would update on disk but the editor window's Pinia store would stay stale
//! until next reload.

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::preferences::store;

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
    store::set(&app, &key, value.clone())?;
    let mut patch = Map::new();
    patch.insert(key, value);
    let _ = app.emit("mt://prefs/changed", serde_json::json!({ "patch": patch }));
    Ok(())
}

#[tauri::command]
pub fn cmd_set_preferences(app: AppHandle, patch: Map<String, Value>) -> AppResult<()> {
    store::set_many(&app, patch.clone())?;
    let _ = app.emit("mt://prefs/changed", serde_json::json!({ "patch": patch }));
    Ok(())
}

#[tauri::command]
pub fn cmd_get_user_data(app: AppHandle) -> AppResult<Value> {
    // User-data is a separate store; for now reuse the preferences one and
    // return the `_userData` sub-tree. Will split into a dedicated store
    // when image upload / cli script settings need it.
    let all = store::get_all(&app)?;
    Ok(all
        .get("_userData")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default())))
}

#[tauri::command]
pub fn cmd_set_user_data(app: AppHandle, patch: Map<String, Value>) -> AppResult<()> {
    let mut bundle = Map::new();
    bundle.insert("_userData".into(), Value::Object(patch.clone()));
    store::set_many(&app, bundle)?;
    let _ = app.emit("mt://userdata/changed", serde_json::json!({ "patch": patch }));
    Ok(())
}
