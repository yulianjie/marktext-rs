//! Image upload commands — local copy, GitHub upload, Unsplash search.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
pub struct LocalSaveArgs {
    pub source_path: Option<PathBuf>,
    pub data_url: Option<String>,
    pub target_dir: PathBuf,
    pub filename: String,
}

#[derive(Debug, Serialize)]
pub struct LocalSaveResult {
    pub path: PathBuf,
}

#[tauri::command]
pub async fn cmd_save_image_local(args: LocalSaveArgs) -> AppResult<LocalSaveResult> {
    tokio::fs::create_dir_all(&args.target_dir).await.ok();
    let target = args.target_dir.join(&args.filename);
    if let Some(src) = args.source_path {
        tokio::fs::copy(&src, &target).await?;
    } else if let Some(data_url) = args.data_url {
        let bytes = decode_data_url(&data_url)?;
        tokio::fs::write(&target, bytes).await?;
    } else {
        return Err(AppError::InvalidArgument(
            "either source_path or data_url is required".into(),
        ));
    }
    Ok(LocalSaveResult { path: target })
}

fn decode_data_url(data_url: &str) -> AppResult<Vec<u8>> {
    use base64_decode::decode;
    let comma = data_url
        .find(',')
        .ok_or_else(|| AppError::InvalidArgument("malformed data url".into()))?;
    let payload = &data_url[(comma + 1)..];
    decode(payload).map_err(|e| AppError::Other(e.to_string()))
}

// Tiny base64 fallback so we don't pull a whole crate for one call site.
mod base64_decode {
    pub fn decode(input: &str) -> Result<Vec<u8>, String> {
        let cleaned: String = input.chars().filter(|c| !c.is_whitespace()).collect();
        let mut out = Vec::with_capacity(cleaned.len() * 3 / 4);
        let mut buf: u32 = 0;
        let mut bits = 0u8;
        for c in cleaned.chars() {
            if c == '=' {
                break;
            }
            let v = match c {
                'A'..='Z' => c as u32 - 'A' as u32,
                'a'..='z' => c as u32 - 'a' as u32 + 26,
                '0'..='9' => c as u32 - '0' as u32 + 52,
                '+' | '-' => 62,
                '/' | '_' => 63,
                _ => return Err(format!("invalid base64 char: {c}")),
            };
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8 & 0xff);
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Deserialize)]
pub struct GithubUploadArgs {
    pub token: String,
    pub owner: String,
    pub repo: String,
    pub branch: Option<String>,
    pub path: String,
    pub content_base64: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GithubUploadResult {
    pub download_url: String,
    pub sha: String,
}

#[tauri::command]
pub async fn cmd_upload_image_github(args: GithubUploadArgs) -> AppResult<GithubUploadResult> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        args.owner, args.repo, args.path
    );
    let body = serde_json::json!({
        "message": args.message.unwrap_or_else(|| "upload from marktext".into()),
        "content": args.content_base64,
        "branch": args.branch,
    });
    let resp = client
        .put(&url)
        .bearer_auth(&args.token)
        .header("User-Agent", "marktext-rs")
        .json(&body)
        .send()
        .await?
        .error_for_status()?;
    let v: serde_json::Value = resp.json().await?;
    let download_url = v
        .pointer("/content/download_url")
        .and_then(|s| s.as_str())
        .ok_or_else(|| AppError::Other("missing download_url".into()))?
        .to_string();
    let sha = v
        .pointer("/content/sha")
        .and_then(|s| s.as_str())
        .unwrap_or_default()
        .to_string();
    Ok(GithubUploadResult { download_url, sha })
}

#[derive(Debug, Deserialize)]
pub struct UnsplashSearchArgs {
    pub query: String,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub access_key: String,
}

#[tauri::command]
pub async fn cmd_search_unsplash(args: UnsplashSearchArgs) -> AppResult<serde_json::Value> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.unsplash.com/search/photos")
        .query(&[
            ("query", args.query.as_str()),
            ("page", &args.page.unwrap_or(1).to_string()),
            ("per_page", &args.per_page.unwrap_or(20).to_string()),
        ])
        .header("Authorization", format!("Client-ID {}", args.access_key))
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json().await?)
}
