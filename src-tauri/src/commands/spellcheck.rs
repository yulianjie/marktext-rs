//! Spellcheck commands — stubbed for now.
//!
//! Original used Electron's built-in spellchecker. Replacement plan: bundle
//! `spellbook` (Hunspell-compatible) + `.dic` files in `resources/dictionaries`.
//! For Phase 1 we only expose the IPC shape so the frontend can integrate
//! without further churn.

use crate::error::AppResult;

#[tauri::command]
pub fn cmd_spellcheck_words(_words: Vec<String>) -> AppResult<Vec<String>> {
    Ok(Vec::new())
}

#[tauri::command]
pub fn cmd_spellcheck_add_word(_word: String) -> AppResult<()> {
    Ok(())
}

#[tauri::command]
pub fn cmd_spellcheck_remove_word(_word: String) -> AppResult<()> {
    Ok(())
}

#[tauri::command]
pub fn cmd_spellcheck_available_dictionaries() -> AppResult<Vec<String>> {
    Ok(Vec::new())
}
