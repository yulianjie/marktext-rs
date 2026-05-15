//! IPC event payloads — typed structs shared between Rust `emit` calls and
//! the renderer-side `listen` subscribers.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecondInstance {
    pub argv: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileWatchEvent {
    Created { path: PathBuf },
    Modified { path: PathBuf },
    Removed { path: PathBuf },
    Renamed { from: PathBuf, to: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenFilePayload {
    pub path: PathBuf,
    pub markdown: String,
    pub encoding: String,
    pub line_ending: String,
}
