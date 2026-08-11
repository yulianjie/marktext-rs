//! Native menu builder.
//!
//! Mirrors the legacy `marktext/src/main/menu/` tree at the top level
//! (File / Edit / Paragraph / Format / View / Window / Help). Items that
//! drive the editor emit `mt://menu/<id>` events to the focused webview;
//! the renderer maps them to the corresponding store action.
//!
//! Most application shortcuts are native menu accelerators. Focus-sensitive
//! editor mutations (undo/redo/select-all, headings, and inline formatting)
//! intentionally stay accelerator-free here so the renderer can route them to
//! Muya, CodeMirror, or a focused text input without mixing history systems.
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

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder,
        PredefinedMenuItem, SubmenuBuilder,
    },
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

/// Renderer-remappable actions. The native menu reads the same persisted map
/// so it never keeps a stale hard-coded accelerator after a user edit.
const DEFAULT_KEYBINDINGS: &[(&str, &str)] = &[
    ("file.new", "Ctrl+T"),
    ("file.open", "Ctrl+O"),
    ("file.openFolder", "Ctrl+Shift+O"),
    ("file.save", "Ctrl+S"),
    ("file.saveAs", "Ctrl+Shift+S"),
    ("file.closeTab", "Ctrl+W"),
    ("file.print", "Ctrl+P"),
    ("edit.find", "Ctrl+F"),
    ("edit.replace", "Ctrl+H"),
    ("view.toggleSidebar", "Ctrl+Shift+B"),
    ("view.commandPalette", "Ctrl+Shift+P"),
];

const RESERVED_ACCELERATORS: &[&str] = &[
    "Ctrl+Z",
    "Ctrl+Y",
    "Ctrl+Shift+Z",
    "Ctrl+X",
    "Ctrl+C",
    "Ctrl+V",
    "Ctrl+A",
    "Ctrl+Q",
    "Ctrl+Shift+N",
    "Ctrl+Shift+W",
    "Ctrl+1",
    "Ctrl+2",
    "Ctrl+3",
    "Ctrl+4",
    "Ctrl+5",
    "Ctrl+6",
    "Ctrl+B",
    "Ctrl+I",
    "Ctrl+D",
    "Ctrl+`",
    "Ctrl+L",
    "Ctrl+Shift+I",
    "Ctrl+Alt+S",
    "Ctrl+=",
    "Ctrl+-",
    "Ctrl+0",
    "Ctrl+,",
];

// Suspend native accelerators while Preferences records a shortcut. The OS
// menu would otherwise consume combinations such as Ctrl+S before the
// focused webview input can observe them.
static ACCELERATORS_ENABLED: AtomicBool = AtomicBool::new(true);
static MENU_REBUILD_LOCK: Mutex<()> = Mutex::new(());

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
        let _ = items
            .strikethrough
            .set_checked(active.iter().any(|f| f == "del"));
        let _ = items
            .inline_code
            .set_checked(active.iter().any(|f| f == "inline_code"));
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
        // Do not broadcast a menu action when no window is focused. Commands
        // such as Save and Close are window-scoped; an app-wide fallback
        // would run them in every editor and could overwrite or discard data.
        tracing::debug!(menu_item = %id, "ignoring menu action with no focused window");
    });

    // Live-rebuild on language / theme / recent-files / keybinding change. The renderer
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
        let has_theme_mode = patch.get("autoSwitchTheme").is_some();
        let has_recent = patch.get("recentFiles").is_some();
        let has_keybindings = patch.get("keybindings").is_some();
        if !has_language && !has_theme && !has_theme_mode && !has_recent && !has_keybindings {
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
    let _guard = MENU_REBUILD_LOCK
        .lock()
        .expect("menu rebuild mutex poisoned");
    rebuild_unlocked(app, locale)
}

fn rebuild_unlocked(app: &AppHandle<Wry>, locale: &str) -> AppResult<()> {
    let strings = i18n::for_locale(locale);
    let (menu, format_items) =
        build_menu(app, strings).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    // `App::set_menu` is only available on the App during setup. For runtime
    // updates, set the menu per-window — Tauri's app-level menu propagates
    // automatically, but setting it on each window guarantees the swap on
    // platforms where the menu is hosted by the window (Windows / Linux).
    app.set_menu(menu)
        .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    // `AppHandle::set_menu` propagates the app-wide menu to every window
    // whose menu is empty, including Preferences. Remove it again before the
    // rebuild completes so changing language/theme/keybindings never leaves
    // a menu bar on the utility window.
    if let Some(settings) = app.get_webview_window("settings") {
        settings
            .remove_menu()
            .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    }
    if let Some(state) = app.try_state::<FormatMenuHandles>() {
        state.store(format_items);
    }
    Ok(())
}

/// Rebuild the application menu with or without accelerators. Preferences
/// uses this only for the short lifetime of its shortcut recorder.
pub fn set_accelerators_enabled(app: &AppHandle<Wry>, enabled: bool) -> AppResult<()> {
    let _guard = MENU_REBUILD_LOCK
        .lock()
        .expect("menu rebuild mutex poisoned");
    let previous = ACCELERATORS_ENABLED.swap(enabled, Ordering::SeqCst);
    if previous == enabled {
        return Ok(());
    }
    let locale = read_locale(app);
    if let Err(error) = rebuild_unlocked(app, &locale) {
        ACCELERATORS_ENABLED.store(previous, Ordering::SeqCst);
        return Err(error);
    }
    Ok(())
}

/// Pull the `language` preference from the persisted store. Falls back to
/// `"en"` if the store is missing the key or unreadable.
fn read_locale<R: Runtime>(app: &AppHandle<R>) -> String {
    match prefs_store::get(app, "language") {
        Ok(Some(v)) => v
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "en".into()),
        _ => "en".into(),
    }
}

fn read_keybindings<R: Runtime>(app: &AppHandle<R>, cmd_or_ctrl: &str) -> HashMap<String, String> {
    let persisted = prefs_store::get(app, "keybindings").ok().flatten();
    keybindings_from_value(persisted.as_ref(), cmd_or_ctrl)
}

fn keybindings_from_value(
    persisted: Option<&serde_json::Value>,
    cmd_or_ctrl: &str,
) -> HashMap<String, String> {
    let mut bindings: HashMap<String, String> = DEFAULT_KEYBINDINGS
        .iter()
        .map(|(action, accel)| {
            (
                (*action).to_string(),
                native_accelerator(accel, cmd_or_ctrl).unwrap_or_default(),
            )
        })
        .collect();

    let Some(persisted) = persisted.and_then(serde_json::Value::as_object) else {
        return bindings;
    };
    for (action, _) in DEFAULT_KEYBINDINGS {
        let Some(raw) = persisted.get(*action).and_then(serde_json::Value::as_str) else {
            continue;
        };
        // Invalid legacy accelerators disable only that native binding; they
        // must never make rebuilding the entire menu fail.
        bindings.insert(
            (*action).to_string(),
            native_accelerator(raw, cmd_or_ctrl).unwrap_or_default(),
        );
    }
    bindings
}

fn native_accelerator(raw: &str, cmd_or_ctrl: &str) -> Option<String> {
    let mut primary = false;
    let mut shift = false;
    let mut alt = false;
    let mut key: Option<String> = None;

    for token in raw
        .split('+')
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "cmd" | "command" | "cmdorctrl" | "commandorcontrol" => {
                primary = true;
            }
            "shift" => shift = true,
            "alt" | "option" => alt = true,
            _ if key.is_none() => key = Some(token.to_string()),
            _ => return None,
        }
    }

    let key = normalize_accelerator_key(&key.filter(|key| !key.is_empty())?)?;
    // User shortcuts always require the platform command modifier or Alt so
    // navigation/editing keys can never be captured globally by accident.
    if !primary && !alt {
        return None;
    }

    let mut parts = Vec::with_capacity(4);
    if primary {
        parts.push(cmd_or_ctrl.to_string());
    }
    if shift {
        parts.push("Shift".into());
    }
    if alt {
        parts.push("Alt".into());
    }
    parts.push(key);
    Some(parts.join("+"))
}

fn normalize_accelerator_key(key: &str) -> Option<String> {
    let lower = key.to_ascii_lowercase();
    let canonical = match lower.as_str() {
        "escape" | "esc" => "Esc",
        "space" => "Space",
        "backspace" => "Backspace",
        "capslock" => "CapsLock",
        "enter" => "Enter",
        "tab" => "Tab",
        "delete" => "Delete",
        "end" => "End",
        "home" => "Home",
        "insert" => "Insert",
        "pagedown" => "PageDown",
        "pageup" => "PageUp",
        "printscreen" => "PrintScreen",
        "scrolllock" => "ScrollLock",
        "arrowup" | "up" => "Up",
        "arrowdown" | "down" => "Down",
        "arrowleft" | "left" => "Left",
        "arrowright" | "right" => "Right",
        "numlock" => "NumLock",
        "audiovolumedown" | "volumedown" => "VolumeDown",
        "audiovolumeup" | "volumeup" => "VolumeUp",
        "audiovolumemute" | "volumemute" => "VolumeMute",
        _ if key.chars().count() == 1
            && key
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || "`\\[],=-.';/".contains(c)) =>
        {
            return Some(key.to_ascii_uppercase());
        }
        _ if lower
            .strip_prefix('f')
            .and_then(|digits| digits.parse::<u8>().ok())
            .is_some_and(|number| (1..=24).contains(&number)) =>
        {
            return Some(lower.to_ascii_uppercase());
        }
        _ if lower.starts_with("numpad") || lower.starts_with("num") => {
            let supported = [
                "numpad0",
                "numpad1",
                "numpad2",
                "numpad3",
                "numpad4",
                "numpad5",
                "numpad6",
                "numpad7",
                "numpad8",
                "numpad9",
                "numpadadd",
                "numpadplus",
                "numpaddecimal",
                "numpaddivide",
                "numpadenter",
                "numpadequal",
                "numpadmultiply",
                "numpadsubtract",
                "num0",
                "num1",
                "num2",
                "num3",
                "num4",
                "num5",
                "num6",
                "num7",
                "num8",
                "num9",
                "numadd",
                "numplus",
                "numdecimal",
                "numdivide",
                "numenter",
                "numequal",
                "nummultiply",
                "numsubtract",
            ];
            if !supported.contains(&lower.as_str()) {
                return None;
            }
            return Some(key.to_string());
        }
        _ => return None,
    };
    Some(canonical.into())
}

pub(crate) fn normalize_user_accelerator(raw: &str) -> Option<String> {
    native_accelerator(raw, "Ctrl")
}

pub(crate) fn is_remappable_action(action: &str) -> bool {
    DEFAULT_KEYBINDINGS.iter().any(|(id, _)| *id == action)
}

pub(crate) fn is_reserved_accelerator(accelerator: &str) -> bool {
    let key = accelerator_key(accelerator);
    RESERVED_ACCELERATORS
        .iter()
        .any(|reserved| accelerator_key(reserved) == key)
}

fn accelerator_key(accel: &str) -> String {
    accel.to_ascii_lowercase().replace(' ', "")
}

fn unclaimed_fixed_accel<'a>(
    candidate: &'a str,
    keybindings: &HashMap<String, String>,
) -> Option<&'a str> {
    let candidate_key = accelerator_key(candidate);
    if keybindings
        .values()
        .any(|accel| !accel.is_empty() && accelerator_key(accel) == candidate_key)
    {
        None
    } else {
        Some(candidate)
    }
}

fn build_menu(
    app: &AppHandle<Wry>,
    s: &i18n::MenuStrings,
) -> tauri::Result<(Menu<Wry>, FormatItems)> {
    let cmd_or_ctrl = if cfg!(target_os = "macos") {
        "Cmd"
    } else {
        "Ctrl"
    };
    let keybindings = read_keybindings(app, cmd_or_ctrl);
    let custom_accel = |id: &str| {
        keybindings
            .get(id)
            .map(String::as_str)
            .filter(|accel| !accel.is_empty())
    };

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
            &mi(app, "file.new", s.new_tab, custom_accel("file.new"))?,
            &mi(
                app,
                "file.newWindow",
                s.new_window,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+Shift+N"), &keybindings),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.open", s.open_file, custom_accel("file.open"))?,
            &mi(
                app,
                "file.openFolder",
                s.open_folder,
                custom_accel("file.openFolder"),
            )?,
            &recent_submenu,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.save", s.save, custom_accel("file.save"))?,
            &mi(app, "file.saveAs", s.save_as, custom_accel("file.saveAs"))?,
            &mi(app, "file.saveAll", s.save_all, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.exportHtml", s.export_html, None)?,
            &mi(app, "file.exportDocx", s.export_docx, None)?,
            &mi(app, "file.exportOdt", s.export_odt, None)?,
            &mi(app, "file.exportEpub", s.export_epub, None)?,
            &mi(app, "file.print", s.print, custom_accel("file.print"))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(
                app,
                "file.preferences",
                s.preferences,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+,"), &keybindings),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &mi(
                app,
                "file.closeTab",
                s.close_tab,
                custom_accel("file.closeTab"),
            )?,
            &mi(
                app,
                "file.closeWindow",
                s.close_window,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+Shift+W"), &keybindings),
            )?,
            &PredefinedMenuItem::quit(app, None)?,
        ])
        .build()?;

    // These stay ordinary items so clicks emit stable ids through
    // `mt://menu/action`. They intentionally have no native accelerators:
    // Ctrl/Cmd+Z, redo, and select-all must reach the focused DOM control so
    // the renderer can choose Muya, CodeMirror, or native input history.
    let edit = SubmenuBuilder::new(app, s.edit)
        .items(&[
            &mi(app, "edit.undo", s.undo, None)?,
            &mi(app, "edit.redo", s.redo, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &mi(app, "edit.selectAll", s.select_all, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "edit.find", s.find, custom_accel("edit.find"))?,
            &mi(app, "edit.replace", s.replace, custom_accel("edit.replace"))?,
        ])
        .build()?;

    let paragraph = SubmenuBuilder::new(app, s.paragraph)
        .items(&[
            &mi(app, "paragraph.h1", s.heading_1, None)?,
            &mi(app, "paragraph.h2", s.heading_2, None)?,
            &mi(app, "paragraph.h3", s.heading_3, None)?,
            &mi(app, "paragraph.h4", s.heading_4, None)?,
            &mi(app, "paragraph.h5", s.heading_5, None)?,
            &mi(app, "paragraph.h6", s.heading_6, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "paragraph.paragraph", s.paragraph_item, None)?,
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
    let bold = check_mi(app, "format.bold", s.bold, None)?;
    let italic = check_mi(app, "format.italic", s.italic, None)?;
    let strikethrough = check_mi(app, "format.strikethrough", s.strikethrough, None)?;
    let inline_code = check_mi(app, "format.inlineCode", s.inline_code, None)?;

    let format = SubmenuBuilder::new(app, s.format)
        .items(&[
            &bold,
            &italic,
            &strikethrough,
            &inline_code,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "format.link", s.hyperlink, None)?,
            &mi(app, "format.image", s.image, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "format.clear", s.clear_formatting, None)?,
        ])
        .build()?;

    let view = SubmenuBuilder::new(app, s.view)
        .items(&[
            &mi(
                app,
                "view.toggleSidebar",
                s.toggle_sidebar,
                custom_accel("view.toggleSidebar"),
            )?,
            &mi(app, "view.toggleTabBar", s.toggle_tab_bar, None)?,
            &mi(app, "view.toggleToolbar", s.toggle_toolbar, None)?,
            &mi(app, "view.toggleStatusBar", s.toggle_status_bar, None)?,
            &mi(
                app,
                "view.toggleSourceCode",
                s.toggle_source_code,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+Alt+S"), &keybindings),
            )?,
            &mi(app, "view.toggleTypewriter", s.toggle_typewriter, None)?,
            &mi(app, "view.toggleFocus", s.toggle_focus, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(
                app,
                "view.commandPalette",
                s.command_palette,
                custom_accel("view.commandPalette"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &mi(
                app,
                "view.zoomIn",
                s.zoom_in,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+="), &keybindings),
            )?,
            &mi(
                app,
                "view.zoomOut",
                s.zoom_out,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+-"), &keybindings),
            )?,
            &mi(
                app,
                "view.zoomReset",
                s.zoom_reset,
                unclaimed_fixed_accel(&format!("{cmd_or_ctrl}+0"), &keybindings),
            )?,
        ])
        .build()?;

    // ── Theme submenu (built-in themes, one ✓ per active) ──────────
    let active_theme: String = prefs_store::get(app, "theme")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "light".into());
    let follow_system_theme = prefs_store::get(app, "autoSwitchTheme")
        .ok()
        .flatten()
        .and_then(|value| value.as_i64())
        == Some(1);

    let mut theme_items: Vec<(String, CheckMenuItem<Wry>)> =
        Vec::with_capacity(BUILTIN_THEMES.len());
    for id in BUILTIN_THEMES {
        let label = theme_label(s, id);
        let item = CheckMenuItemBuilder::with_id(format!("theme.set:{id}"), label)
            .checked(!follow_system_theme && *id == active_theme)
            .enabled(!follow_system_theme)
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
            &mi(app, "help.openDocs", s.documentation, None)?,
            &mi(app, "help.openIssues", s.report_issue, None)?,
            &mi(app, "help.checkForUpdates", s.check_for_updates, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "help.about", s.about, None)?,
        ])
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &file,
            &edit,
            &paragraph,
            &format,
            &view,
            &theme_menu,
            &window,
            &help,
        ])
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
    let mut chars = base.chars();
    let prefix: String = chars.by_ref().take(60).collect();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

/// Helper to build a labelled menu item with an optional accelerator.
fn mi<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    if ACCELERATORS_ENABLED.load(Ordering::SeqCst) {
        if let Some(a) = accel {
            match MenuItemBuilder::with_id(id, label)
                .accelerator(a)
                .build(app)
            {
                Ok(item) => return Ok(item),
                Err(error) => {
                    tracing::warn!(%id, accelerator = %a, %error, "ignoring unsupported menu accelerator");
                }
            }
        }
    }
    MenuItemBuilder::with_id(id, label).build(app)
}

/// Helper to build a stateful (✓) menu item with an optional accelerator.
fn check_mi(
    app: &AppHandle<Wry>,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<CheckMenuItem<Wry>> {
    if ACCELERATORS_ENABLED.load(Ordering::SeqCst) {
        if let Some(a) = accel {
            match CheckMenuItemBuilder::with_id(id, label)
                .accelerator(a)
                .build(app)
            {
                Ok(item) => return Ok(item),
                Err(error) => {
                    tracing::warn!(%id, accelerator = %a, %error, "ignoring unsupported check-menu accelerator");
                }
            }
        }
    }
    CheckMenuItemBuilder::with_id(id, label).build(app)
}

/// Used by editor commands that want to update the menu's "Always on Top"
/// toggle state. No-op for now; will hook up when we add stateful items.
#[allow(dead_code)]
pub fn refresh_state(_app: &AppHandle<Wry>) {}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn persisted_keybindings_override_defaults_and_are_native_normalized() {
        let value = json!({
            "file.save": "ctrl+alt+k",
            "edit.find": "f"
        });
        let bindings = keybindings_from_value(Some(&value), "Ctrl");
        assert_eq!(bindings["file.save"], "Ctrl+Alt+K");
        assert_eq!(bindings["file.open"], "Ctrl+O");
        // A malformed/bare legacy value disables only its own native binding.
        assert_eq!(bindings["edit.find"], "");
    }

    #[test]
    fn primary_modifier_maps_to_command_on_macos_and_bare_keys_are_rejected() {
        assert_eq!(
            native_accelerator("ctrl+shift+s", "Cmd").as_deref(),
            Some("Cmd+Shift+S")
        );
        assert_eq!(native_accelerator("F1", "Cmd"), None);
        assert_eq!(native_accelerator("Shift+Up", "Cmd"), None);
        assert_eq!(
            native_accelerator("Alt+F1", "Cmd").as_deref(),
            Some("Alt+F1")
        );
    }

    #[test]
    fn default_sidebar_binding_does_not_shadow_bold() {
        let bindings = keybindings_from_value(None, "Ctrl");
        assert_eq!(bindings["view.toggleSidebar"], "Ctrl+Shift+B");
        assert_eq!(unclaimed_fixed_accel("Ctrl+B", &bindings), Some("Ctrl+B"));
        assert_eq!(unclaimed_fixed_accel("Ctrl+I", &bindings), Some("Ctrl+I"));
    }

    #[test]
    fn reserved_accelerators_and_unknown_keys_are_rejected() {
        let bold = normalize_user_accelerator("Ctrl+B").expect("valid fixed shortcut");
        assert!(is_reserved_accelerator(&bold));

        for accelerator in ["Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+A", "Ctrl+1"] {
            let normalized = normalize_user_accelerator(accelerator)
                .expect("valid renderer-owned editor shortcut");
            assert!(is_reserved_accelerator(&normalized));
        }

        let save = normalize_user_accelerator("Ctrl+S").expect("valid remappable shortcut");
        assert!(!is_reserved_accelerator(&save));

        assert_eq!(normalize_user_accelerator("Ctrl+Dead"), None);
        assert_eq!(normalize_user_accelerator("Ctrl+Process"), None);
    }

    #[test]
    fn recent_labels_truncate_unicode_at_character_boundaries() {
        let basename = format!("{}-notes.md", "文".repeat(60));
        let label = display_recent_label(&format!("C:/documents/{basename}"));
        assert_eq!(label, format!("{}…", "文".repeat(60)));
        assert_eq!(display_recent_label("C:/documents/短文.md"), "短文.md");
    }
}
