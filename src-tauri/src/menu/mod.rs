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

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, AppHandle, Emitter, Runtime, Wry,
};

use crate::error::AppResult;

pub fn install(app: &mut App) -> AppResult<()> {
    let handle = app.handle();
    let menu = build_menu(handle).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    app.set_menu(menu)?;
    app.on_menu_event(move |app, event| {
        let id = event.id().0.as_str();
        // The renderer subscribes to a single channel and switches on the id.
        let _ = app.emit("mt://menu/action", id.to_string());
    });
    Ok(())
}

fn build_menu(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let cmd_or_ctrl = if cfg!(target_os = "macos") { "Cmd" } else { "Ctrl" };

    let file = SubmenuBuilder::new(app, "File")
        .items(&[
            &mi(app, "file.new", "New Tab", Some(&format!("{cmd_or_ctrl}+T")))?,
            &mi(app, "file.newWindow", "New Window", Some(&format!("{cmd_or_ctrl}+Shift+N")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.open", "Open File…", Some(&format!("{cmd_or_ctrl}+O")))?,
            &mi(app, "file.openFolder", "Open Folder…", Some(&format!("{cmd_or_ctrl}+Shift+O")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.save", "Save", Some(&format!("{cmd_or_ctrl}+S")))?,
            &mi(app, "file.saveAs", "Save As…", Some(&format!("{cmd_or_ctrl}+Shift+S")))?,
            &mi(app, "file.saveAll", "Save All", None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.exportHtml", "Export HTML…", None)?,
            &mi(app, "file.print", "Print / Export PDF…", Some(&format!("{cmd_or_ctrl}+P")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "file.closeTab", "Close Tab", Some(&format!("{cmd_or_ctrl}+W")))?,
            &mi(app, "file.closeWindow", "Close Window", Some(&format!("{cmd_or_ctrl}+Shift+W")))?,
            &PredefinedMenuItem::quit(app, None)?,
        ])
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .items(&[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "edit.find", "Find", Some(&format!("{cmd_or_ctrl}+F")))?,
            &mi(app, "edit.replace", "Find & Replace", Some(&format!("{cmd_or_ctrl}+H")))?,
        ])
        .build()?;

    let paragraph = SubmenuBuilder::new(app, "Paragraph")
        .items(&[
            &mi(app, "paragraph.h1", "Heading 1", Some(&format!("{cmd_or_ctrl}+1")))?,
            &mi(app, "paragraph.h2", "Heading 2", Some(&format!("{cmd_or_ctrl}+2")))?,
            &mi(app, "paragraph.h3", "Heading 3", Some(&format!("{cmd_or_ctrl}+3")))?,
            &mi(app, "paragraph.h4", "Heading 4", Some(&format!("{cmd_or_ctrl}+4")))?,
            &mi(app, "paragraph.h5", "Heading 5", Some(&format!("{cmd_or_ctrl}+5")))?,
            &mi(app, "paragraph.h6", "Heading 6", Some(&format!("{cmd_or_ctrl}+6")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "paragraph.paragraph", "Paragraph", Some(&format!("{cmd_or_ctrl}+0")))?,
            &mi(app, "paragraph.blockquote", "Blockquote", None)?,
            &mi(app, "paragraph.unorderedList", "Bulleted List", None)?,
            &mi(app, "paragraph.orderedList", "Numbered List", None)?,
            &mi(app, "paragraph.taskList", "Task List", None)?,
            &mi(app, "paragraph.codeBlock", "Code Block", None)?,
            &mi(app, "paragraph.table", "Table", None)?,
            &mi(app, "paragraph.horizontalRule", "Horizontal Rule", None)?,
        ])
        .build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .items(&[
            &mi(app, "format.bold", "Bold", Some(&format!("{cmd_or_ctrl}+B")))?,
            &mi(app, "format.italic", "Italic", Some(&format!("{cmd_or_ctrl}+I")))?,
            &mi(app, "format.strikethrough", "Strikethrough", Some(&format!("{cmd_or_ctrl}+D")))?,
            &mi(app, "format.inlineCode", "Inline Code", Some(&format!("{cmd_or_ctrl}+`")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "format.link", "Hyperlink", Some(&format!("{cmd_or_ctrl}+L")))?,
            &mi(app, "format.image", "Image", Some(&format!("{cmd_or_ctrl}+Shift+I")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "format.clear", "Clear Formatting", None)?,
        ])
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .items(&[
            &mi(app, "view.toggleSidebar", "Toggle Sidebar", Some(&format!("{cmd_or_ctrl}+B")))?,
            &mi(app, "view.toggleTabBar", "Toggle Tab Bar", None)?,
            &mi(app, "view.toggleSourceCode", "Toggle Source Code Mode", Some(&format!("{cmd_or_ctrl}+Alt+S")))?,
            &mi(app, "view.toggleTypewriter", "Toggle Typewriter Mode", None)?,
            &mi(app, "view.toggleFocus", "Toggle Focus Mode", None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "view.commandPalette", "Command Palette", Some(&format!("{cmd_or_ctrl}+Shift+P")))?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "view.zoomIn", "Zoom In", Some(&format!("{cmd_or_ctrl}+=")))?,
            &mi(app, "view.zoomOut", "Zoom Out", Some(&format!("{cmd_or_ctrl}+-")))?,
            &mi(app, "view.zoomReset", "Reset Zoom", Some(&format!("{cmd_or_ctrl}+0")))?,
        ])
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .items(&[
            &PredefinedMenuItem::minimize(app, None)?,
            &mi(app, "window.alwaysOnTop", "Always on Top", None)?,
            &mi(app, "window.fullscreen", "Toggle Full Screen", Some("F11"))?,
        ])
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .items(&[
            &mi(app, "help.openSettings", "Preferences", Some(&format!("{cmd_or_ctrl}+,")))?,
            &mi(app, "help.openDocs", "Documentation", None)?,
            &mi(app, "help.openIssues", "Report an Issue", None)?,
            &PredefinedMenuItem::separator(app)?,
            &mi(app, "help.about", "About MarkText", None)?,
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
