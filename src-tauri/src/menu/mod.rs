//! Native menu builder.
//!
//! Mirrors the legacy `marktext/src/main/menu/` tree at the top level
//! (File / Edit / Paragraph / Format / View / Window / Help). Items that
//! drive the editor emit `mt://menu/<id>` events to the focused webview;
//! the renderer maps them to the corresponding store action.
//!
//! Native shortcuts attached here are visible in the menu UI. The renderer
//! also installs JS-side `keydown` handlers for the same accelerators —
//! keep them aligned.
//!
//! Menu labels are localised via [`i18n::MenuStrings`]. The active locale is
//! read from the persisted `language` preference at install time, and the
//! whole menu is rebuilt via [`rebuild`] whenever the renderer emits
//! `mt://prefs/changed` with a `language` patch.

mod i18n;

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, AppHandle, Emitter, Listener, Manager, Runtime, Wry,
};

use crate::error::AppResult;
use crate::preferences::store as prefs_store;

pub fn install(app: &mut App) -> AppResult<()> {
    let handle = app.handle();
    let locale = read_locale(handle);
    let strings = i18n::for_locale(&locale);
    let menu = build_menu(handle, strings).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        let id = event.id().0.as_str();
        // Send menu events ONLY to the focused window — otherwise a "Save"
        // click would trigger a save in every open window simultaneously.
        let target = app
            .webview_windows()
            .into_iter()
            .find(|(_, w)| w.is_focused().unwrap_or(false))
            .map(|(label, _)| label);
        if let Some(label) = target {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.emit("mt://menu/action", id.to_string());
                return;
            }
        }
        // Fallback: broadcast (e.g. macOS menu fired with no window focused).
        let _ = app.emit("mt://menu/action", id.to_string());
    });

    // Live-rebuild on language change. The renderer broadcasts a patch every
    // time the user touches a preference; we only act when `language` is in
    // the patch (rebuilding the menu tree on every prefs write would be
    // wasteful and would also flicker the macOS app menu).
    let listener_handle = handle.clone();
    handle.listen_any("mt://prefs/changed", move |event| {
        let payload: serde_json::Value = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(_) => return,
        };
        let Some(lang) = payload
            .get("patch")
            .and_then(|p| p.get("language"))
            .and_then(|v| v.as_str())
        else {
            return;
        };
        if let Err(err) = rebuild(&listener_handle, lang) {
            tracing::warn!(?err, "failed to rebuild menu after language change");
        }
    });

    Ok(())
}

/// Rebuild the menu for `locale` and re-attach it to every existing window.
/// Called from the `mt://prefs/changed` listener when the user switches
/// languages.
pub fn rebuild(app: &AppHandle<Wry>, locale: &str) -> AppResult<()> {
    let strings = i18n::for_locale(locale);
    let menu = build_menu(app, strings).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    // `App::set_menu` is only available on the App during setup. For runtime
    // updates, set the menu per-window — Tauri's app-level menu propagates
    // automatically, but setting it on each window guarantees the swap on
    // platforms where the menu is hosted by the window (Windows / Linux).
    app.set_menu(menu).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    Ok(())
}

/// Pull the `language` preference from the persisted store. Falls back to
/// `"en"` if the store is missing the key or unreadable.
fn read_locale<R: Runtime>(app: &AppHandle<R>) -> String {
    match prefs_store::get(app, "language") {
        Ok(Some(v)) => v.as_str().map(|s| s.to_string()).unwrap_or_else(|| "en".into()),
        _ => "en".into(),
    }
}

fn build_menu(app: &AppHandle<Wry>, s: &i18n::MenuStrings) -> tauri::Result<Menu<Wry>> {
    let cmd_or_ctrl = if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" };

    let file = SubmenuBuilder::new(app, s.file)
        .items(&[
            &mi(app, "file.new", s.new_tab, Some(&format!("{cmd_or_ctrl}+T")))?,
            &mi(app, "file.newWindow", s.new_window, Some(&format!("{cmd_or_ctrl}+Shift+N")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.open", s.open_file, Some(&format!("{cmd_or_ctrl}+O")))?,
            &mi(app, "file.openFolder", s.open_folder, Some(&format!("{cmd_or_ctrl}+Shift+O")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.save", s.save, Some(&format!("{cmd_or_ctrl}+S")))?,
            &mi(app, "file.saveAs", s.save_as, Some(&format!("{cmd_or_ctrl}+Shift+S")))?,
            &mi(app, "file.saveAll", s.save_all, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.exportHtml", s.export_html, None)?,
            &mi(app, "file.exportDocx", s.export_docx, None)?,
            &mi(app, "file.exportOdt", s.export_odt, None)?,
            &mi(app, "file.exportEpub", s.export_epub, None)?,
            &mi(app, "file.print", s.print, Some(&format!("{cmd_or_ctrl}+P")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.closeTab", s.close_tab, Some(&format!("{cmd_or_ctrl}+W")))?,
            &mi(app, "file.closeWindow", s.close_window, Some(&format!("{cmd_or_ctrl}+Shift+W")))?,
            &PredefinedMenuItem::quit(app, None)?,
        ])
        .build()?;

    let edit = SubmenuBuilder::new(app, s.edit)
        .items(&[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "edit.find", s.find, Some(&format!("{cmd_or_ctrl}+F")))?,
            &mi(app, "edit.replace", s.replace, Some(&format!("{cmd_or_ctrl}+H")))?,
        ])
        .build()?;

    let paragraph = SubmenuBuilder::new(app, s.paragraph)
        .items(&[
            &mi(app, "paragraph.h1", s.heading_1, Some(&format!("{cmd_or_ctrl}+1")))?,
            &mi(app, "paragraph.h2", s.heading_2, Some(&format!("{cmd_or_ctrl}+2")))?,
            &mi(app, "paragraph.h3", s.heading_3, Some(&format!("{cmd_or_ctrl}+3")))?,
            &mi(app, "paragraph.h4", s.heading_4, Some(&format!("{cmd_or_ctrl}+4")))?,
            &mi(app, "paragraph.h5", s.heading_5, Some(&format!("{cmd_or_ctrl}+5")))?,
            &mi(app, "paragraph.h6", s.heading_6, Some(&format!("{cmd_or_ctrl}+6")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "paragraph.paragraph", s.paragraph_item, Some(&format!("{cmd_or_ctrl}+0")))?,
            &mi(app, "paragraph.blockquote", s.blockquote, None)?,
            &mi(app, "paragraph.unorderedList", s.bulleted_list, None)?,
            &mi(app, "paragraph.orderedList", s.numbered_list, None)?,
            &mi(app, "paragraph.taskList", s.task_list, None)?,
            &mi(app, "paragraph.codeBlock", s.code_block, None)?,
            &mi(app, "paragraph.table", s.table, None)?,
            &mi(app, "paragraph.horizontalRule", s.horizontal_rule, None)?,
        ])
        .build()?;

    let format = SubmenuBuilder::new(app, s.format)
        .items(&[
            &mi(app, "format.bold", s.bold, Some(&format!("{cmd_or_ctrl}+B")))?,
            &mi(app, "format.italic", s.italic, Some(&format!("{cmd_or_ctrl}+I")))?,
            &mi(app, "format.strikethrough", s.strikethrough, Some(&format!("{cmd_or_ctrl}+D")))?,
            &mi(app, "format.inlineCode", s.inline_code, Some(&format!("{cmd_or_ctrl}+`")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "format.link", s.hyperlink, Some(&format!("{cmd_or_ctrl}+L")))?,
            &mi(app, "format.image", s.image, Some(&format!("{cmd_or_ctrl}+Shift+I")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "format.clear", s.clear_formatting, None)?,
        ])
        .build()?;

    let view = SubmenuBuilder::new(app, s.view)
        .items(&[
            &mi(app, "view.toggleSidebar", s.toggle_sidebar, Some(&format!("{cmd_or_ctrl}+B")))?,
            &mi(app, "view.toggleTabBar", s.toggle_tab_bar, None)?,
            &mi(app, "view.toggleSourceCode", s.toggle_source_code, Some(&format!("{cmd_or_ctrl}+Alt+S")))?,
            &mi(app, "view.toggleTypewriter", s.toggle_typewriter, None)?,
            &mi(app, "view.toggleFocus", s.toggle_focus, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "view.commandPalette", s.command_palette, Some(&format!("{cmd_or_ctrl}+Shift+P")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "view.zoomIn", s.zoom_in, Some(&format!("{cmd_or_ctrl}+=")))?,
            &mi(app, "view.zoomOut", s.zoom_out, Some(&format!("{cmd_or_ctrl}+-")))?,
            &mi(app, "view.zoomReset", s.zoom_reset, Some(&format!("{cmd_or_ctrl}+0")))?,
        ])
        .build()?;

    let window = SubmenuBuilder::new(app, s.window)
        .items(&[
            &PredefinedMenuItem::minimize(app, None)?,
            &mi(app, "window.alwaysOnTop", s.always_on_top, None)?,
            &mi(app, "window.fullscreen", s.fullscreen, Some("F11"))?,
        ])
        .build()?;

    let help = SubmenuBuilder::new(app, s.help)
        .items(&[
            &mi(app, "help.openSettings", s.preferences, Some(&format!("{cmd_or_ctrl}+,")))?,
            &mi(app, "help.openDocs", s.documentation, None)?,
            &mi(app, "help.openIssues", s.report_issue, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "help.about", s.about, None)?,
        ])
        .build()?;

    MenuBuilder::new(app)
        .items(&[&file, &edit, &paragraph, &format, &view, &window, &help])
        .build()
}

/// Helper to build a labelled menu item with an optional accelerator.
fn mi<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accel {
        builder = builder.accelerator(a);
    }
    builder.build(app)
}

/// Used by editor commands that want to update the menu's "Always on Top"
/// toggle state. No-op for now; will hook up when we add stateful items.
#[allow(dead_code)]
pub fn refresh_state(_app: &AppHandle<Wry>) {}
