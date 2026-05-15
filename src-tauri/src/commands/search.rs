//! Folder search — wraps the `grep` / `ignore` crates.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
pub struct SearchArgs {
    pub root: PathBuf,
    pub query: String,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub regex: Option<bool>,
    pub include_hidden: Option<bool>,
    pub follow_symlinks: Option<bool>,
    pub max_file_size: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub path: PathBuf,
    pub line: u64,
    pub column: u64,
    pub preview: String,
}

#[tauri::command]
pub async fn cmd_search_in_folder(args: SearchArgs) -> AppResult<Vec<SearchHit>> {
    tokio::task::spawn_blocking(move || run_search(args))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

fn run_search(args: SearchArgs) -> AppResult<Vec<SearchHit>> {
    use grep::searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};
    use ignore::WalkBuilder;

    let pattern = if args.regex.unwrap_or(false) {
        args.query.clone()
    } else {
        regex_escape(&args.query)
    };
    let pattern = if args.whole_word.unwrap_or(false) {
        format!(r"\b{pattern}\b")
    } else {
        pattern
    };
    let matcher = grep::regex::RegexMatcherBuilder::new()
        .case_insensitive(!args.case_sensitive.unwrap_or(false))
        .build(&pattern)
        .map_err(|e| AppError::Other(e.to_string()))?;

    let mut hits = Vec::new();
    let walker = WalkBuilder::new(&args.root)
        .hidden(!args.include_hidden.unwrap_or(false))
        .follow_links(args.follow_symlinks.unwrap_or(true))
        .max_filesize(args.max_file_size)
        .build();

    let mut searcher: Searcher = SearcherBuilder::new().build();
    struct Collector<'a> {
        hits: &'a mut Vec<SearchHit>,
        path: PathBuf,
    }
    impl<'a> Sink for Collector<'a> {
        type Error = std::io::Error;
        fn matched(
            &mut self,
            _searcher: &Searcher,
            mat: &SinkMatch<'_>,
        ) -> Result<bool, Self::Error> {
            let line = mat.line_number().unwrap_or(0);
            let preview = String::from_utf8_lossy(mat.bytes()).into_owned();
            self.hits.push(SearchHit {
                path: self.path.clone(),
                line,
                column: 0,
                preview: preview.trim_end_matches(&['\r', '\n'][..]).to_string(),
            });
            Ok(true)
        }
    }

    for entry in walker.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let mut collector = Collector {
            hits: &mut hits,
            path: path.to_path_buf(),
        };
        let _ = searcher.search_path(&matcher, path, &mut collector);
    }
    Ok(hits)
}

fn regex_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if "\\.+*?()[]{}|^$".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

// Silence the unused import warning when `RegexMatcher` is only referenced by
// the inner builder; keeps the explicit type around for readability.
#[allow(dead_code)]
fn _force_use() -> Option<grep::regex::RegexMatcher> {
    None
}
