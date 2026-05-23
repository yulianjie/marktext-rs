//! Export commands — HTML / PDF.
//!
//! HTML export is a thin file-write wrapper; the renderer produces the HTML
//! string. PDF export is delivered by emitting a request to the renderer to
//! call `window.print()`. The OS print dialog supports "Save as PDF" on every
//! supported platform — there is no Tauri-native `printToPDF` equivalent,
//! and the renderer already has all the styling context needed.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn cmd_export_html(path: PathBuf, html: String) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    tokio::fs::write(path, html).await?;
    Ok(())
}

/// Triggers a print dialog in the target window. The renderer is responsible
/// for actually invoking `window.print()` after styling itself for print —
/// we just nudge it via an event. Keeps Rust ignorant of webview print
/// internals (which Tauri 2 does not expose programmatically).
#[tauri::command]
pub async fn cmd_export_pdf(app: AppHandle, window_label: String) -> AppResult<()> {
    let win = app
        .get_webview_window(&window_label)
        .ok_or_else(|| AppError::NotFound(format!("window {window_label}")))?;
    win.emit("mt://export/print", ())
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

/// Options for Pandoc PDF export — paper size, orientation, optional title
/// and custom CSS. Mirrors the original Electron export dialog's knobs.
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PandocPdfOptions {
    #[serde(default)]
    pub paper_size: Option<String>,
    #[serde(default)]
    pub orientation: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub toc: Option<bool>,
}

/// Export a markdown string to PDF via Pandoc.
///
/// Uses `-t pdf` (Pandoc picks an available engine: wkhtmltopdf / xelatex /
/// weasyprint, in that order). Paper size and orientation are forwarded via
/// `-V` variables which work with both wkhtmltopdf and the LaTeX engines.
#[tauri::command]
pub async fn cmd_pandoc_pdf_export(
    markdown: String,
    output_path: PathBuf,
    options: Option<PandocPdfOptions>,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;
    use tokio::process::Command;
    let opts = options.unwrap_or_default();
    let mut cmd = Command::new("pandoc");
    cmd.arg("-f").arg("markdown");
    cmd.arg("-t").arg("pdf");
    cmd.arg("-o").arg(&output_path);
    cmd.arg("--standalone");
    if let Some(paper) = opts.paper_size.as_deref().filter(|s| !s.is_empty()) {
        cmd.arg("-V").arg(format!("papersize:{paper}"));
    }
    if matches!(opts.orientation.as_deref(), Some("landscape")) {
        cmd.arg("-V").arg("geometry:landscape");
    }
    if let Some(title) = opts.title.as_deref().filter(|s| !s.is_empty()) {
        cmd.arg("-V").arg(format!("title:{title}"));
    }
    if opts.toc.unwrap_or(false) {
        cmd.arg("--toc");
    }
    let mut child = cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::Other(format!(
                "failed to start pandoc — make sure it's on PATH ({e})"
            ))
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(markdown.as_bytes()).await.map_err(|e| {
            AppError::Other(format!("failed to write to pandoc stdin: {e}"))
        })?;
        drop(stdin);
    }
    let out = child.wait_with_output().await.map_err(|e| {
        AppError::Other(format!("pandoc exited unexpectedly: {e}"))
    })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Other(format!("pandoc PDF failed: {stderr}")));
    }
    Ok(())
}

/// Convert markdown to one of pandoc's output formats by piping it through
/// a `pandoc` subprocess and writing the result to `output_path`.
///
/// `output_format` is passed as `-t <format>` (e.g. "docx", "odt", "epub",
/// "latex"). Requires pandoc on PATH; if missing, returns an actionable
/// error message.
#[tauri::command]
pub async fn cmd_pandoc_convert(
    markdown: String,
    output_path: PathBuf,
    output_format: String,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;
    use tokio::process::Command;
    let mut child = Command::new("pandoc")
        .arg("-f")
        .arg("markdown")
        .arg("-t")
        .arg(&output_format)
        .arg("-o")
        .arg(&output_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::Other(format!(
                "failed to start pandoc — make sure it's on PATH ({e})"
            ))
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(markdown.as_bytes()).await.map_err(|e| {
            AppError::Other(format!("failed to write to pandoc stdin: {e}"))
        })?;
        drop(stdin);
    }
    let out = child.wait_with_output().await.map_err(|e| {
        AppError::Other(format!("pandoc exited unexpectedly: {e}"))
    })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Other(format!("pandoc failed: {stderr}")));
    }
    Ok(())
}
