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

/// PicGo upload — calls a PicGo CLI binary with one or more image paths.
/// The user configures the binary path in preferences (`picgoPath`); a
/// missing or empty value defaults to `picgo` on the PATH.
///
/// PicGo prints uploaded URLs to stdout, one per line. We collect those and
/// hand them back to the renderer. Exit code != 0 (or empty stdout) is
/// reported as an upload failure.
#[derive(Debug, Deserialize)]
pub struct PicgoUploadArgs {
    pub binary: Option<String>,
    pub source_paths: Vec<PathBuf>,
}

#[derive(Debug, Serialize)]
pub struct PicgoUploadResult {
    pub urls: Vec<String>,
}

#[tauri::command]
pub async fn cmd_upload_image_picgo(args: PicgoUploadArgs) -> AppResult<PicgoUploadResult> {
    if args.source_paths.is_empty() {
        return Err(AppError::InvalidArgument("no source paths".into()));
    }
    let binary = match args.binary {
        Some(s) if !s.trim().is_empty() => s,
        _ => "picgo".to_string(),
    };
    let mut cmd = tokio::process::Command::new(&binary);
    cmd.arg("upload");
    for p in &args.source_paths {
        cmd.arg(p);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Other(format!("failed to spawn picgo: {e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::Other(format!(
            "picgo exited with {:?}: {}",
            output.status.code(),
            err
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let urls: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| l.starts_with("http://") || l.starts_with("https://"))
        .collect();
    if urls.is_empty() {
        return Err(AppError::Other(format!(
            "picgo produced no URLs (stdout: {stdout})"
        )));
    }
    Ok(PicgoUploadResult { urls })
}

/// Custom-script upload — runs the user's shell script (or executable) with
/// the image paths as positional args. Same contract as PicGo: URLs on
/// stdout, one per line. The user supplies the executable path through the
/// `cliScript` preference.
#[derive(Debug, Deserialize)]
pub struct ScriptUploadArgs {
    pub script: String,
    pub source_paths: Vec<PathBuf>,
}

#[derive(Debug, Serialize)]
pub struct ScriptUploadResult {
    pub urls: Vec<String>,
}

#[tauri::command]
pub async fn cmd_upload_image_script(args: ScriptUploadArgs) -> AppResult<ScriptUploadResult> {
    if args.script.trim().is_empty() {
        return Err(AppError::InvalidArgument("script path is empty".into()));
    }
    if args.source_paths.is_empty() {
        return Err(AppError::InvalidArgument("no source paths".into()));
    }
    let mut cmd = tokio::process::Command::new(&args.script);
    for p in &args.source_paths {
        cmd.arg(p);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Other(format!("failed to spawn upload script: {e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::Other(format!(
            "upload script exited with {:?}: {}",
            output.status.code(),
            err
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let urls: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    if urls.is_empty() {
        return Err(AppError::Other(format!(
            "upload script produced no URLs (stdout: {stdout})"
        )));
    }
    Ok(ScriptUploadResult { urls })
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
