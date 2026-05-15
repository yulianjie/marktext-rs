//! Persisted preferences via `tauri-plugin-store`.

use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use crate::error::{AppError, AppResult};

const STORE_PATH: &str = "preferences.json";

pub fn get_all<R: Runtime>(app: &AppHandle<R>) -> AppResult<Value> {
    let store = app.store(STORE_PATH).map_err(|e| AppError::Other(e.to_string()))?;
    let mut obj = serde_json::Map::new();
    for entry in store.entries() {
        obj.insert(entry.0, entry.1);
    }
    Ok(Value::Object(obj))
}

pub fn get<R: Runtime>(app: &AppHandle<R>, key: &str) -> AppResult<Option<Value>> {
    let store = app.store(STORE_PATH).map_err(|e| AppError::Other(e.to_string()))?;
    Ok(store.get(key))
}

pub fn set<R: Runtime>(app: &AppHandle<R>, key: &str, value: Value) -> AppResult<()> {
    let store = app.store(STORE_PATH).map_err(|e| AppError::Other(e.to_string()))?;
    store.set(key.to_string(), value);
    store.save().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub fn set_many<R: Runtime>(
    app: &AppHandle<R>,
    patch: serde_json::Map<String, Value>,
) -> AppResult<()> {
    let store = app.store(STORE_PATH).map_err(|e| AppError::Other(e.to_string()))?;
    for (k, v) in patch {
        store.set(k, v);
    }
    store.save().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}
