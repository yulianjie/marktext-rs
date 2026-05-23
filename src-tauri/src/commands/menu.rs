//! Menu-state commands.
//!
//! The renderer pushes `selectionFormats` events out of Muya every time the
//! cursor crosses a formatted span; we mirror them onto the native Format
//! submenu's CheckMenuItems so `Format → Bold` shows a ✓ when the caret is
//! on bold text.

use tauri::{AppHandle, Manager};

use crate::error::AppResult;
use crate::menu::FormatMenuHandles;

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
