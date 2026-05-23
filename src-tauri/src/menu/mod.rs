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
//!
//! Inline-format items (bold / italic / strikethrough / inline code) are
//! [`CheckMenuItem`]s so the renderer can flip ✓ marks to reflect the
//! current cursor selection. Handles are stashed in [`FormatMenuHandles`]
//! (a [`tauri::State`]) so the `cmd_set_format_menu_state` command can find
//! them. Handles are refreshed every time the menu is rebuilt.

mod i18n;

use std::sync::Mutex;

use tauri::{
    menu::{CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, AppHandle, Emitter, Listener, Manager, Runtime, Wry,
};

use crate::error::AppResult;
use crate::preferences::store as prefs_store;

/// Built-in theme IDs surfaced in the Theme menu. Order matches the menu.
const BUILTIN_THEMES: &[&str] = &[
    "light",
    "dark",
    "one-dark",
    "material-dark",
    "ulysses-light",
    "graphite-light",
    "github-blue",
];

/// Live handles to the 4 inline-format `CheckMenuItem`s. Updated whenever
/// the menu is rebuilt; consumed by `cmd_set_format_menu_state` to toggle
/// the ✓ marks in response to the editor's `selectionFormats` event.
#[derive(Default)]
pub struct FormatMenuHandles {
    inner: Mutex<Option<FormatItems>>,
}

struct FormatItems {
    bold: CheckMenuItem<Wry>,
    italic: CheckMenuItem<Wry>,
    strikethrough: CheckMenuItem<Wry>,
    inline_code: CheckMenuItem<Wry>,
    /// Theme `CheckMenuItem`s keyed by theme id. Updated when the user picks
    /// a new theme so only one ✓ is set.
    themes: Vec<(String, CheckMenuItem<Wry>)>,
}

impl FormatMenuHandles {
    fn store(&self, items: FormatItems) {
        *self.inner.lock().expect("format menu mutex poisoned") = Some(items);
    }

    /// Apply a flat list of active format names (`em`, `strong`, `del`,
    /// `inline_code`, …). Anything we don't track is ignored.
    pub fn apply(&self, active: &[String]) {
        let guard = self.inner.lock().expect("format menu mutex poisoned");
        let Some(items) = guard.as_ref() else { return };
        let _ = items.bold.set_checked(active.iter().any(|f| f == "strong"));
        let _ = items.italic.set_checked(active.iter().any(|f| f == "em"));
        let _ = items.strikethrough.set_checked(active.iter().any(|f| f == "del"));
        let _ = items.inline_code.set_checked(active.iter().any(|f| f == "inline_code"));
    }

    /// Tick the ✓ next to `theme_id`; clear the others.
    pub fn apply_theme(&self, theme_id: &str) {
        let guard = self.inner.lock().expect("format menu mutex poisoned");
        let Some(items) = guard.as_ref() else { return };
        for (id, item) in &items.themes {
            let _ = item.set_checked(id == theme_id);
        }
    }
}

pub fn install(app: &mut App) -> AppResult<()> {
    let handle = app.handle();
    let locale = read_locale(handle);
    let strings = i18n::for_locale(&locale);
    let (menu, format_items) =
        build_menu(handle, strings).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    app.set_menu(menu)?;
    if let Some(state) = app.try_state::<FormatMenuHandles>() {
        state.store(format_items);
    }

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

    // Live-rebuild on language / theme / recent-files change. The renderer
    // broadcasts a patch every time the user touches a preference; we only
    // act when one of those three keys is in the patch (rebuilding the menu
    // tree on every prefs write would be wasteful and would also flicker
    // the macOS app menu).
    let listener_handle = handle.clone();
    handle.listen_any("mt://prefs/changed", move |event| {
        let payload: serde_json::Value = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(_) => return,
        };
        let patch = match payload.get("patch") {
            Some(p) => p,
            None => return,
        };
        let has_language = patch.get("language").and_then(|v| v.as_str()).is_some();
        let has_theme = patch.get("theme").is_some();
        let has_recent = patch.get("recentFiles").is_some();
        if !has_language && !has_theme && !has_recent {
            return;
        }
        // For recent-files-only updates we still rebuild because the submenu
        // items are baked in at build time; for theme-only updates we could
        // get away with just flipping the ✓ marks but a rebuild keeps the
        // accelerator-free check items consistent across windows.
        let locale = patch
            .get("language")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| read_locale(&listener_handle));
        if let Err(err) = rebuild(&listener_handle, &locale) {
            tracing::warn!(?err, "failed to rebuild menu after prefs change");
        }
    });

    Ok(())
}

/// Rebuild the menu for `locale` and re-attach it to every existing window.
/// Called from the `mt://prefs/changed` listener when the user switches
/// languages.
pub fn rebuild(app: &AppHandle<Wry>, locale: &str) -> AppResult<()> {
    let strings = i18n::for_locale(locale);
    let (menu, format_items) =
        build_menu(app, strings).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    // `App::set_menu` is only available on the App during setup. For runtime
    // updates, set the menu per-window — Tauri's app-level menu propagates
    // automatically, but setting it on each window guarantees the swap on
    // platforms where the menu is hosted by the window (Windows / Linux).
    app.set_menu(menu).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    if let Some(state) = app.try_state::<FormatMenuHandles>() {
        state.store(format_items);
    }
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

fn build_menu(
    app: &AppHandle<Wry>,
    s: &i18n::MenuStrings,
) -> tauri::Result<(Menu<Wry>, FormatItems)> {
    let cmd_or_ctrl = if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" };

    // ── Open Recent submenu (dynamic) ──────────────────────────────
    let recent_files: Vec<String> = prefs_store::get(app, "recentFiles")
        .ok()
        .flatten()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.into_iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut recent_builder = SubmenuBuilder::new(app, s.open_recent);
    if recent_files.is_empty() {
        let placeholder = MenuItemBuilder::with_id("file.openRecent.empty", s.no_recent)
            .enabled(false)
            .build(app)?;
        recent_builder = recent_builder.item(&placeholder);
    } else {
        for path in recent_files.iter().take(20) {
            let label = display_recent_label(path);
            let id = format!("file.openRecent:{path}");
            let item = MenuItemBuilder::with_id(&id, label).build(app)?;
            recent_builder = recent_builder.item(&item);
        }
        recent_builder = recent_builder.separator();
        let clear = MenuItemBuilder::with_id("file.clearRecent", s.clear_recent).build(app)?;
        recent_builder = recent_builder.item(&clear);
    }
    let recent_submenu = recent_builder.build()?;

    let file = SubmenuBuilder::new(app, s.file)
        .items(&[
            &mi(app, "file.new", s.new_tab, Some(&format!("{cmd_or_ctrl}+T")))?,
            &mi(app, "file.newWindow", s.new_window, Some(&format!("{cmd_or_ctrl}+Shift+N")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.open", s.open_file, Some(&format!("{cmd_or_ctrl}+O")))?,
            &mi(app, "file.openFolder", s.open_folder, Some(&format!("{cmd_or_ctrl}+Shift+O")))?,
            &recent_submenu,
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

    // Inline-format check items — handles are returned so the renderer can
    // flip ✓ marks via `cmd_set_format_menu_state`. The 3 link/image/clear
    // items remain plain MenuItems since they're actions, not states.
    let bold = check_mi(app, "format.bold", s.bold, Some(&format!("{cmd_or_ctrl}+B")))?;
    let italic = check_mi(app, "format.italic", s.italic, Some(&format!("{cmd_or_ctrl}+I")))?;
    let strikethrough = check_mi(app, "format.strikethrough", s.strikethrough, Some(&format!("{cmd_or_ctrl}+D")))?;
    let inline_code = check_mi(app, "format.inlineCode", s.inline_code, Some(&format!("{cmd_or_ctrl}+`")))?;

    let format = SubmenuBuilder::new(app, s.format)
        .items(&[
            &bold,
            &italic,
            &strikethrough,
            &inline_code,
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

    // ── Theme submenu (built-in themes, one ✓ per active) ──────────
    let active_theme: String = prefs_store::get(app, "theme")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "light".into());

    let mut theme_items: Vec<(String, CheckMenuItem<Wry>)> = Vec::with_capacity(BUILTIN_THEMES.len());
    for id in BUILTIN_THEMES {
        let label = theme_label(s, id);
        let item = CheckMenuItemBuilder::with_id(format!("theme.set:{id}"), label)
            .checked(*id == active_theme)
            .build(app)?;
        theme_items.push(((*id).to_string(), item));
    }
    let mut theme_builder = SubmenuBuilder::new(app, s.theme);
    for (_, item) in &theme_items {
        theme_builder = theme_builder.item(item);
    }
    let theme_menu = theme_builder.build()?;

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
            &mi(app, "help.checkForUpdates", s.check_for_updates, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "help.about", s.about, None)?,
        ])
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &paragraph, &format, &view, &theme_menu, &window, &help])
        .build()?;

    Ok((
        menu,
        FormatItems {
            bold,
            italic,
            strikethrough,
            inline_code,
            themes: theme_items,
        },
    ))
}

/// Map a theme id (`light`, `one-dark`, …) to the localised display string.
fn theme_label(s: &i18n::MenuStrings, id: &str) -> &'static str {
    match id {
        "light" => s.theme_light,
        "dark" => s.theme_dark,
        "one-dark" => s.theme_one_dark,
        "material-dark" => s.theme_material_dark,
        "ulysses-light" => s.theme_ulysses_light,
        "graphite-light" => s.theme_graphite_light,
        "github-blue" => s.theme_github_blue,
        _ => "",
    }
}

/// Take a full path and produce a compact menu label (basename, max ~60
/// chars). Keeps the menu scannable even with deep recent paths.
fn display_recent_label(path: &str) -> String {
    let normalised = path.replace('\\', "/");
    let base = normalised.rsplit('/').next().unwrap_or(path);
    if base.len() > 60 {
        format!("{}…", &base[..60])
    } else {
        base.to_string()
    }
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

/// Helper to build a stateful (✓) menu item with an optional accelerator.
fn check_mi(
    app: &AppHandle<Wry>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<CheckMenuItem<Wry>> {
    let mut builder = CheckMenuItemBuilder::with_id(id, label);
    if let Some(a) = accel {
        builder = builder.accelerator(a);
    }
    builder.build(app)
}

/// Used by editor commands that want to update the menu's "Always on Top"
/// toggle state. No-op for now; will hook up when we add stateful items.
#[allow(dead_code)]
pub fn refresh_state(_app: &AppHandle<Wry>) {}
