//! Native desktop blur. The renderer remains opaque until this succeeds.

use crate::error::{AppError, AppResult};

#[cfg(target_os = "linux")]
mod linux;

#[tauri::command]
pub async fn cmd_window_enable_backdrop(window: tauri::WebviewWindow) -> AppResult<bool> {
    if window.label() != "main" && !window.label().starts_with("editor-") {
        return Ok(false);
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window.run_on_main_thread(move || {
        let result = enable(&target);
        if let Err(error) = &result {
            tracing::warn!(%error, "Desktop blur unavailable; keeping chrome opaque");
        }
        let _ = send.send(result.unwrap_or(false));
    })?;
    receive
        .await
        .map_err(|error| AppError::Other(error.to_string()))
}

fn enable(window: &tauri::WebviewWindow) -> anyhow::Result<bool> {
    #[cfg(target_os = "windows")]
    {
        window_vibrancy::apply_acrylic(window, Some((0, 0, 0, 0)))?;
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        window_vibrancy::apply_vibrancy(
            window,
            window_vibrancy::NSVisualEffectMaterial::Sidebar,
            None,
            None,
        )?;
        Ok(true)
    }
    #[cfg(target_os = "linux")]
    {
        linux::enable(window)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = window;
        Ok(false)
    }
}
