//! Spellcheck commands — Hunspell-compatible via the `spellbook` crate.
//!
//! Dictionaries live in `<app_config_dir>/dictionaries/<lang>/{lang.aff, lang.dic}`.
//! The user is expected to drop `.aff` + `.dic` pairs there (e.g. download
//! from the Hunspell or LibreOffice dictionaries repo). Each unique `lang`
//! subdirectory becomes an available dictionary.
//!
//! A single dictionary is loaded into the global cache at a time — the
//! Muya host calls `cmd_spellcheck_words` for every visible paragraph, and
//! reloads when the user switches language via `cmd_set_preference`
//! (`spellcheckerLanguage`).
//!
//! Custom user words live in `<app_config_dir>/dictionaries/user_words.txt`
//! (one word per line). They're added to the dictionary in memory after
//! load and persisted on `cmd_spellcheck_add_word`.

use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{AppError, AppResult};

struct DictCache {
    lang: String,
    dict: spellbook::Dictionary,
    user_words: Vec<String>,
}

static CACHE: Lazy<Mutex<Option<DictCache>>> = Lazy::new(|| Mutex::new(None));

fn dictionaries_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|p| p.join("dictionaries"))
}

fn user_words_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    dictionaries_dir(app).map(|p| p.join("user_words.txt"))
}

fn load_user_words<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    user_words_path(app)
        .and_then(|p| std::fs::read_to_string(&p).ok())
        .map(|s| {
            s.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn save_user_words<R: Runtime>(app: &AppHandle<R>, words: &[String]) -> AppResult<()> {
    let Some(path) = user_words_path(app) else {
        return Err(AppError::Other("no config dir".into()));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let joined = words.join("\n");
    std::fs::write(&path, joined).map_err(AppError::from)
}

fn ensure_loaded<R: Runtime>(app: &AppHandle<R>, lang: &str) -> AppResult<()> {
    {
        let guard = CACHE.lock().expect("dict mutex poisoned");
        if guard.as_ref().map(|d| d.lang == lang).unwrap_or(false) {
            return Ok(());
        }
    }
    let Some(dir) = dictionaries_dir(app) else {
        return Err(AppError::Other("no config dir".into()));
    };
    let aff_path = dir.join(lang).join(format!("{lang}.aff"));
    let dic_path = dir.join(lang).join(format!("{lang}.dic"));
    let aff = std::fs::read_to_string(&aff_path).map_err(|e| {
        AppError::Other(format!(
            "missing dictionary {}: {e}. Drop {lang}.aff + {lang}.dic into <config>/dictionaries/{lang}/",
            aff_path.display()
        ))
    })?;
    let dic = std::fs::read_to_string(&dic_path).map_err(|e| {
        AppError::Other(format!("missing {}: {e}", dic_path.display()))
    })?;
    let dict = spellbook::Dictionary::new(&aff, &dic)
        .map_err(|e| AppError::Other(format!("invalid dictionary {lang}: {e}")))?;
    let user_words = load_user_words(app);
    *CACHE.lock().expect("dict mutex poisoned") = Some(DictCache {
        lang: lang.to_string(),
        dict,
        user_words,
    });
    Ok(())
}

fn current_lang<R: Runtime>(app: &AppHandle<R>) -> String {
    crate::preferences::store::get(app, "spellcheckerLanguage")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "en_US".into())
}

/// Returns the subset of `words` that the dictionary does NOT recognise.
/// Empty input → empty output. If no dictionary is configured, returns the
/// input unchanged (spellcheck-as-noop instead of erroring out).
#[tauri::command]
pub fn cmd_spellcheck_words<R: Runtime>(
    app: AppHandle<R>,
    words: Vec<String>,
) -> AppResult<Vec<String>> {
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let lang = current_lang(&app);
    if ensure_loaded(&app, &lang).is_err() {
        // Soft-fail: dictionary missing → treat every word as known so the
        // editor doesn't underline everything. The frontend can surface the
        // load error separately if it cares.
        return Ok(Vec::new());
    }
    let guard = CACHE.lock().expect("dict mutex poisoned");
    let Some(cache) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    let misspelled = words
        .into_iter()
        .filter(|w| !cache.dict.check(w) && !cache.user_words.iter().any(|u| u == w))
        .collect();
    Ok(misspelled)
}

/// Get suggestions for a single misspelled word. Returns up to 10 candidates.
#[tauri::command]
pub fn cmd_spellcheck_suggest<R: Runtime>(
    app: AppHandle<R>,
    word: String,
) -> AppResult<Vec<String>> {
    let lang = current_lang(&app);
    if ensure_loaded(&app, &lang).is_err() {
        return Ok(Vec::new());
    }
    let guard = CACHE.lock().expect("dict mutex poisoned");
    let Some(cache) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    cache.dict.suggest(&word, &mut out);
    out.truncate(10);
    Ok(out)
}

#[tauri::command]
pub fn cmd_spellcheck_add_word<R: Runtime>(app: AppHandle<R>, word: String) -> AppResult<()> {
    let trimmed = word.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }
    let mut guard = CACHE.lock().expect("dict mutex poisoned");
    if let Some(cache) = guard.as_mut() {
        if !cache.user_words.iter().any(|u| u == &trimmed) {
            cache.user_words.push(trimmed.clone());
            save_user_words(&app, &cache.user_words)?;
        }
    } else {
        // No dictionary loaded — still persist so the word survives.
        let mut words = load_user_words(&app);
        if !words.iter().any(|u| u == &trimmed) {
            words.push(trimmed);
            save_user_words(&app, &words)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_spellcheck_remove_word<R: Runtime>(app: AppHandle<R>, word: String) -> AppResult<()> {
    let mut guard = CACHE.lock().expect("dict mutex poisoned");
    if let Some(cache) = guard.as_mut() {
        cache.user_words.retain(|u| u != &word);
        save_user_words(&app, &cache.user_words)?;
    } else {
        let mut words = load_user_words(&app);
        words.retain(|u| u != &word);
        save_user_words(&app, &words)?;
    }
    Ok(())
}

/// Enumerate dictionary directories — each subdirectory of
/// `<config>/dictionaries/` that contains both `<name>.aff` and `<name>.dic`
/// counts as one available language.
#[tauri::command]
pub fn cmd_spellcheck_available_dictionaries<R: Runtime>(
    app: AppHandle<R>,
) -> AppResult<Vec<String>> {
    let Some(dir) = dictionaries_dir(&app) else {
        return Ok(Vec::new());
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut langs = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let aff = entry.path().join(format!("{name}.aff"));
        let dic = entry.path().join(format!("{name}.dic"));
        if aff.exists() && dic.exists() {
            langs.push(name);
        }
    }
    langs.sort();
    Ok(langs)
}
