//! Menu-state commands.
//!
//! The renderer pushes `selectionFormats` events out of Muya every time the
//! cursor crosses a formatted span; we mirror them onto the native Format
//! submenu's CheckMenuItems so `Format → Bold` shows a ✓ when the caret is
//! on bold text.

use tauri::{AppHandle, Manager};

use crate::error::AppResult;
use crate::menu::FormatMenuHandles;

/// Open the existing native submenu from the acrylic title bar. Keeping the
/// attached menu hidden preserves accelerators, check marks and recent files.
#[tauri::command]
pub fn cmd_popup_editor_menu(
    window: tauri::WebviewWindow,
    index: usize,
    x: f64,
    y: f64,
) -> AppResult<()> {
    if !(window.label() == "main" || window.label().starts_with("editor-"))
        || index >= 8
        || !x.is_finite()
        || !y.is_finite()
        || x < 0.0
        || y < 0.0
    {
        return Err(crate::error::AppError::InvalidArgument(
            "invalid editor menu request".into(),
        ));
    }
    let menu = window
        .menu()
        .ok_or_else(|| crate::error::AppError::NotFound("editor menu".into()))?;
    let items = menu.items()?;
    let submenu = items
        .get(index)
        .and_then(|item| item.as_submenu())
        .ok_or_else(|| crate::error::AppError::NotFound("editor submenu".into()))?;
    window.popup_menu_at(submenu, tauri::LogicalPosition::new(x, y))?;
    Ok(())
}

/// Update the ✓ state of the Format submenu's inline items. `formats` is
/// the flat list of token names that Muya considers "active" at the
/// current selection — e.g. `["strong", "em"]` for bold+italic.
#[tauri::command]
pub fn cmd_set_format_menu_state(app: AppHandle, formats: Vec<String>) -> AppResult<()> {
    if let Some(state) = app.try_state::<FormatMenuHandles>() {
        state.apply(&formats);
    }
    Ok(())
}
