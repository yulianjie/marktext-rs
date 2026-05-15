//! Markdown file I/O — equivalent to `marktext/src/main/filesystem/markdown.js`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::error::AppResult;
use crate::filesystem::encoding;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedDocument {
    pub path: PathBuf,
    pub markdown: String,
    pub encoding: String,
    pub line_ending: String,
    pub had_decode_errors: bool,
}

pub async fn read_markdown(path: impl AsRef<Path>) -> AppResult<LoadedDocument> {
    let path = path.as_ref().to_path_buf();
    let bytes = fs::read(&path).await?;
    let (text, encoding_name, had_errors) = encoding::detect_and_decode(&bytes)?;
    let line_ending = encoding::detect_line_ending(&text).to_string();
    Ok(LoadedDocument {
        path,
        markdown: text,
        encoding: encoding_name.to_string(),
        line_ending,
        had_decode_errors: had_errors,
    })
}

pub async fn write_markdown(
    path: impl AsRef<Path>,
    markdown: &str,
    encoding_name: &str,
    line_ending: &str,
) -> AppResult<()> {
    let normalized = match line_ending {
        "crlf" => markdown.replace("\r\n", "\n").replace('\n', "\r\n"),
        _ => markdown.replace("\r\n", "\n"),
    };
    let bytes = if encoding_name.eq_ignore_ascii_case("utf-8") {
        normalized.into_bytes()
    } else {
        encoding::encode(&normalized, encoding_name)?
    };
    if let Some(parent) = path.as_ref().parent() {
        fs::create_dir_all(parent).await.ok();
    }
    fs::write(path, bytes).await?;
    Ok(())
}
