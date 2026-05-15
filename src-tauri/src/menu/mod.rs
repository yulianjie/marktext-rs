//! Native menu — equivalent to `marktext/src/main/menu/`.

use tauri::App;

use crate::error::AppResult;

pub fn install(_app: &mut App) -> AppResult<()> {
    // TODO: build the full File / Edit / Paragraph / Format / View / Window /
    // Help menu tree. For now we rely on Tauri's default menu so the app can
    // boot cleanly.
    Ok(())
}
