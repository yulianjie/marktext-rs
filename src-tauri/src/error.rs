//! Unified error / Result types for command handlers.
//!
//! Tauri serializes command errors via `serde`, so a single `AppError` enum
//! that implements `Serialize` is much cleaner than per-command result types.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("tauri: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("watcher: {0}")]
    Notify(#[from] notify::Error),

    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    #[error("schema validation: {0}")]
    Schema(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Other(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
