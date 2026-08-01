//! Embedded preference schema, defaults, and runtime validation.
//!
//! The canonical schema is a map of preference key to JSON-Schema fragment
//! (rather than a complete object schema), so each value is compiled and
//! validated independently. A small, explicit set of renderer-owned runtime
//! keys lives beside the canonical preferences; arbitrary unknown keys and the
//! reserved `_userData` subtree are never accepted by the generic API.

use std::collections::HashMap;

use jsonschema::Validator;
use once_cell::sync::Lazy;
use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};

pub const SCHEMA_JSON: &str = include_str!("../../../src/common/preferences-schema.json");

pub static SCHEMA: Lazy<Value> =
    Lazy::new(|| serde_json::from_str(SCHEMA_JSON).expect("preferences schema must be valid JSON"));

static VALIDATORS: Lazy<HashMap<String, Validator>> = Lazy::new(|| {
    SCHEMA
        .as_object()
        .expect("preferences schema root must be an object")
        .iter()
        .map(|(key, schema)| {
            let validator = jsonschema::validator_for(schema)
                .unwrap_or_else(|error| panic!("invalid schema for preference `{key}`: {error}"));
            (key.clone(), validator)
        })
        .collect()
});

/// These values are persisted in `preferences.json`, but are renderer runtime
/// data rather than editor preferences from the canonical schema. Keep this
/// allow-list deliberately small; `_userData` has its own API below.
const RUNTIME_KEYS: &[&str] = &["keybindings", "recentFiles", "recentFolders"];

const USER_DATA_KEYS: &[&str] = &[
    "imageFolderPath",
    "webImages",
    "cloudImages",
    "currentUploader",
    "githubToken",
    "imageBed",
    "cliScript",
    "picgoPath",
];

/// Return a fresh map containing every default declared by the canonical
/// schema. Defaults are merged at read time and are not eagerly persisted.
pub fn defaults() -> Map<String, Value> {
    SCHEMA
        .as_object()
        .expect("preferences schema root must be an object")
        .iter()
        .filter_map(|(key, property)| {
            property
                .get("default")
                .cloned()
                .map(|value| (key.clone(), value))
        })
        .collect()
}

pub fn is_known_preference_key(key: &str) -> bool {
    VALIDATORS.contains_key(key) || RUNTIME_KEYS.contains(&key)
}

pub fn validate_preference(key: &str, value: &Value) -> AppResult<()> {
    if key == "_userData" {
        return Err(AppError::Schema(
            "`_userData` is reserved; use the user-data command".into(),
        ));
    }

    if let Some(validator) = VALIDATORS.get(key) {
        let errors: Vec<String> = validator
            .iter_errors(value)
            .take(3)
            .map(|error| error.to_string())
            .collect();
        if errors.is_empty() {
            return Ok(());
        }
        return Err(AppError::Schema(format!(
            "invalid value for `{key}`: {}",
            errors.join("; ")
        )));
    }

    match key {
        "keybindings" => validate_keybindings(value),
        "recentFiles" | "recentFolders" => validate_string_array(key, value),
        _ => Err(AppError::Schema(format!("unknown preference key `{key}`"))),
    }
}

pub fn validate_patch(patch: &Map<String, Value>) -> AppResult<()> {
    for (key, value) in patch {
        validate_preference(key, value)?;
    }
    Ok(())
}

fn validate_keybindings(value: &Value) -> AppResult<()> {
    let Some(bindings) = value.as_object() else {
        return Err(AppError::Schema(
            "`keybindings` must be an object of string accelerators".into(),
        ));
    };
    let mut assigned = HashMap::<String, String>::new();
    for (action, value) in bindings {
        if !crate::menu::is_remappable_action(action) {
            return Err(AppError::Schema(format!(
                "unknown keybinding action `{action}`"
            )));
        }
        let Some(accel) = value.as_str() else {
            return Err(AppError::Schema(format!(
                "keybinding `{action}` must be a string"
            )));
        };
        let Some(normalized) = crate::menu::normalize_user_accelerator(accel) else {
            return Err(AppError::Schema(format!(
                "keybinding `{action}` has an unsupported accelerator `{accel}`"
            )));
        };
        if crate::menu::is_reserved_accelerator(&normalized) {
            return Err(AppError::Schema(format!(
                "keybinding `{action}` uses reserved accelerator `{normalized}`"
            )));
        }
        if let Some(other) = assigned.insert(normalized.clone(), action.clone()) {
            return Err(AppError::Schema(format!(
                "keybindings `{other}` and `{action}` both use `{normalized}`"
            )));
        }
    }
    Ok(())
}

fn validate_string_array(key: &str, value: &Value) -> AppResult<()> {
    let Some(items) = value.as_array() else {
        return Err(AppError::Schema(format!("`{key}` must be an array")));
    };
    if items.iter().any(|item| !item.is_string()) {
        return Err(AppError::Schema(format!(
            "every item in `{key}` must be a string"
        )));
    }
    Ok(())
}

pub fn user_data_defaults() -> Map<String, Value> {
    serde_json::json!({
        "imageFolderPath": "",
        "webImages": [],
        "cloudImages": [],
        "currentUploader": "none",
        "imageBed": {
            "github": { "owner": "", "repo": "", "branch": "" }
        },
        "cliScript": "",
        "picgoPath": ""
    })
    .as_object()
    .expect("user-data defaults must be an object")
    .clone()
}

pub fn validate_user_data_patch(patch: &Map<String, Value>) -> AppResult<()> {
    for (key, value) in patch {
        validate_user_data_value(key, value)?;
    }
    Ok(())
}

pub fn validate_user_data_value(key: &str, value: &Value) -> AppResult<()> {
    if !USER_DATA_KEYS.contains(&key) {
        return Err(AppError::Schema(format!("unknown user-data key `{key}`")));
    }

    match key {
        "imageFolderPath" | "githubToken" | "cliScript" | "picgoPath" => require_string(key, value),
        "webImages" | "cloudImages" => {
            if value.is_array() {
                Ok(())
            } else {
                Err(AppError::Schema(format!("`{key}` must be an array")))
            }
        }
        "currentUploader" => match value.as_str() {
            Some("none" | "github" | "picgo" | "script") => Ok(()),
            _ => Err(AppError::Schema(
                "`currentUploader` must be none, github, picgo, or script".into(),
            )),
        },
        "imageBed" => validate_image_bed(value),
        _ => unreachable!("user-data allow-list and validator must stay aligned"),
    }
}

fn require_string(key: &str, value: &Value) -> AppResult<()> {
    if value.is_string() {
        Ok(())
    } else {
        Err(AppError::Schema(format!("`{key}` must be a string")))
    }
}

fn validate_image_bed(value: &Value) -> AppResult<()> {
    let Some(image_bed) = value.as_object() else {
        return Err(AppError::Schema("`imageBed` must be an object".into()));
    };
    if image_bed.keys().any(|key| key != "github") {
        return Err(AppError::Schema(
            "`imageBed` only supports the `github` configuration".into(),
        ));
    }
    let Some(github) = image_bed.get("github") else {
        return Ok(());
    };
    let Some(github) = github.as_object() else {
        return Err(AppError::Schema(
            "`imageBed.github` must be an object".into(),
        ));
    };
    for (key, value) in github {
        if !matches!(key.as_str(), "owner" | "repo" | "branch") {
            return Err(AppError::Schema(format!(
                "unknown `imageBed.github` key `{key}`"
            )));
        }
        require_string(&format!("imageBed.github.{key}"), value)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn schema_fragments_compile_and_defaults_are_extracted() {
        assert!(SCHEMA.is_object());
        assert_eq!(VALIDATORS.len(), SCHEMA.as_object().unwrap().len());
        let defaults = defaults();
        assert_eq!(defaults.get("autoSave"), Some(&json!(false)));
        assert_eq!(defaults.get("fontSize"), Some(&json!(16)));
        assert_eq!(defaults.get("defaultDirectoryToOpen"), Some(&json!("")));
    }

    #[test]
    fn canonical_constraints_are_enforced() {
        assert!(validate_preference("fontSize", &json!(12)).is_ok());
        assert!(validate_preference("fontSize", &json!(11)).is_err());
        assert!(validate_preference("zoom", &json!(2.1)).is_err());
        assert!(validate_preference("fileSortBy", &json!("unknown")).is_err());
    }

    #[test]
    fn only_explicit_runtime_keys_are_allowed() {
        assert!(validate_preference("keybindings", &json!({ "file.save": "Ctrl+S" })).is_ok());
        assert!(validate_preference("recentFiles", &json!(["a.md"])).is_ok());
        assert!(validate_preference("recentFolders", &json!([1])).is_err());
        assert!(validate_preference("futureTypo", &json!(true)).is_err());
        assert!(validate_preference("_userData", &json!({})).is_err());
    }

    #[test]
    fn user_data_has_an_independent_strict_contract() {
        assert!(validate_user_data_patch(
            json!({
                "githubToken": "secret",
                "imageBed": { "github": { "owner": "o" } }
            })
            .as_object()
            .unwrap()
        )
        .is_ok());
        assert!(validate_user_data_patch(
            json!({ "imageBed": { "github": { "owner": 1 } } })
                .as_object()
                .unwrap()
        )
        .is_err());
        assert!(
            validate_user_data_patch(json!({ "unexpected": true }).as_object().unwrap()).is_err()
        );
    }
}
