//! Embeds the original `schema.json` into the binary so we can validate
//! preference updates without shipping it as a runtime asset.

use once_cell::sync::Lazy;
use serde_json::Value;

// Original schema lives next to the original Electron source so we re-use it
// verbatim while the rewrite is in flight. Once the codebase stabilises we'll
// move the canonical copy under `src-tauri/resources/`.
pub const SCHEMA_JSON: &str = include_str!("../../../src/common/preferences-schema.json");

pub static SCHEMA: Lazy<Value> =
    Lazy::new(|| serde_json::from_str(SCHEMA_JSON).expect("preferences schema must be valid JSON"));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_parses() {
        assert!(SCHEMA.is_object());
    }
}
