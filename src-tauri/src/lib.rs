//! MarkText Tauri backend.
//!
//! Mirrors the responsibilities of the original Electron main process
//! (`marktext/src/main/`). The top-level orchestrator lives in
//! [`app::AppState`]; IPC commands are grouped under [`commands`] and wired
//! up in [`run`].

pub mod app;
pub mod cli;
pub mod commands;
pub mod error;
pub mod filesystem;
pub mod ipc;
pub mod menu;
pub mod preferences;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            tracing::info!(?argv, ?cwd, "second instance launched, forwarding to main");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            // Open any file paths from the second instance's argv. Same
            // shape as the on-startup handler in `app::on_startup`.
            for arg in argv.iter().skip(1) {
                if arg.starts_with("--") || arg.starts_with('-') { continue; }
                let p = std::path::PathBuf::from(arg);
                if p.exists() && p.is_file() {
                    let _ = app.emit("mt://window/open-file", serde_json::json!({ "path": p }));
                }
            }
            let payload = ipc::events::SecondInstance { argv, cwd: cwd.into() };
            let _ = app.emit("mt://second-instance", payload);
        }));
        // Updater plugin requires a public key for release verification —
        // wire it in once we set up code signing (Phase 7).
    }

    builder
        .manage(app::AppState::default())
        .invoke_handler(marktext_handler!())
        .setup(|app| {
            menu::install(app)?;
            app::on_startup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_logging() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,marktext_lib=debug,tauri=info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(true))
        .init();
}
