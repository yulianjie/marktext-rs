//! Preference commands — read/write through `tauri-plugin-store`.

use serde_json::{Map, Value};
use tauri::AppHandle;

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
    store::set(&app, &key, value)
}

#[tauri::command]
pub fn cmd_set_preferences(app: AppHandle, patch: Map<String, Value>) -> AppResult<()> {
    store::set_many(&app, patch)
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
    bundle.insert("_userData".into(), Value::Object(patch));
    store::set_many(&app, bundle)
}
