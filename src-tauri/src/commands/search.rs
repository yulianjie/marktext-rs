//! Folder search — wraps the `grep` / `ignore` crates.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    pub root: PathBuf,
    pub query: String,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub regex: Option<bool>,
    pub include_hidden: Option<bool>,
    pub follow_symlinks: Option<bool>,
    pub max_file_size: Option<u64>,
    pub exclusions: Option<Vec<String>>,
    pub no_ignore: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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
    use grep::matcher::Matcher;
    use grep::searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};
    use ignore::overrides::OverrideBuilder;
    use ignore::WalkBuilder;

    if !args.root.is_dir() {
        return Err(AppError::InvalidArgument(format!(
            "search root is not a readable directory: {}",
            args.root.display()
        )));
    }

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
    let mut walk_builder = WalkBuilder::new(&args.root);
    walk_builder
        .hidden(!args.include_hidden.unwrap_or(false))
        .follow_links(args.follow_symlinks.unwrap_or(true))
        .max_filesize(args.max_file_size);

    let respect_ignore_files = !args.no_ignore.unwrap_or(false);
    walk_builder
        .parents(respect_ignore_files)
        .ignore(respect_ignore_files)
        .git_global(respect_ignore_files)
        .git_ignore(respect_ignore_files)
        .git_exclude(respect_ignore_files);

    if let Some(patterns) = args.exclusions.as_deref() {
        let mut overrides = OverrideBuilder::new(&args.root);
        for raw in patterns {
            let pattern = raw.trim();
            if pattern.is_empty() {
                continue;
            }
            // Search preferences are exclusion-only. Strip a leading `!` so
            // a gitignore-style value cannot accidentally become a whitelist.
            let pattern = pattern.strip_prefix('!').unwrap_or(pattern);
            overrides.add(&format!("!{pattern}")).map_err(|error| {
                AppError::InvalidArgument(format!(
                    "invalid search exclusion pattern `{raw}`: {error}"
                ))
            })?;
        }
        walk_builder.overrides(overrides.build().map_err(|error| {
            AppError::InvalidArgument(format!("invalid search exclusions: {error}"))
        })?);
    }
    let walker = walk_builder.build();

    let mut searcher: Searcher = SearcherBuilder::new().build();
    struct Collector<'a> {
        hits: &'a mut Vec<SearchHit>,
        path: PathBuf,
        matcher: &'a grep::regex::RegexMatcher,
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
            let column = self
                .matcher
                .find(mat.bytes())
                .ok()
                .flatten()
                .map(|matched| {
                    String::from_utf8_lossy(&mat.bytes()[..matched.start()])
                        .chars()
                        .count() as u64
                        + 1
                })
                .unwrap_or(0);
            self.hits.push(SearchHit {
                path: self.path.clone(),
                line,
                column,
                preview: preview.trim_end_matches(&['\r', '\n'][..]).to_string(),
            });
            Ok(true)
        }
    }

    let mut errors = Vec::new();
    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                tracing::warn!(%error, "unable to walk search path");
                errors.push(error.to_string());
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let mut collector = Collector {
            hits: &mut hits,
            path: path.to_path_buf(),
            matcher: &matcher,
        };
        if let Err(error) = searcher.search_path(&matcher, path, &mut collector) {
            tracing::warn!(%error, path = %path.display(), "unable to search file");
            errors.push(format!("{}: {error}", path.display()));
        }
    }
    if hits.is_empty() && !errors.is_empty() {
        let additional = errors.len().saturating_sub(1);
        return Err(AppError::Other(format!(
            "search failed: {}{}",
            errors[0],
            if additional == 0 {
                String::new()
            } else {
                format!(" ({additional} additional errors)")
            }
        )));
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

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::*;

    fn args(root: PathBuf) -> SearchArgs {
        SearchArgs {
            root,
            query: "needle".into(),
            case_sensitive: None,
            whole_word: None,
            regex: None,
            include_hidden: None,
            follow_symlinks: None,
            max_file_size: None,
            exclusions: None,
            no_ignore: None,
        }
    }

    #[test]
    fn search_args_deserialize_camel_case() {
        let parsed: SearchArgs = serde_json::from_value(json!({
            "root": ".",
            "query": "needle",
            "caseSensitive": true,
            "wholeWord": true,
            "includeHidden": true,
            "followSymlinks": false,
            "maxFileSize": 1024,
            "exclusions": ["target/**"],
            "noIgnore": true
        }))
        .unwrap();
        assert_eq!(parsed.case_sensitive, Some(true));
        assert_eq!(parsed.whole_word, Some(true));
        assert_eq!(parsed.max_file_size, Some(1024));
        assert_eq!(parsed.exclusions.unwrap(), vec!["target/**"]);
        assert_eq!(parsed.no_ignore, Some(true));
    }

    #[test]
    fn exclusions_and_no_ignore_affect_walk_results() {
        let root = std::env::temp_dir().join(format!("marktext-search-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("visible.md"), "needle").unwrap();
        fs::write(root.join("ignored.md"), "needle").unwrap();
        fs::write(root.join("excluded.md"), "needle").unwrap();
        fs::write(root.join(".ignore"), "ignored.md\n").unwrap();

        let mut default_args = args(root.clone());
        default_args.exclusions = Some(vec!["excluded.md".into()]);
        let default_hits = run_search(default_args).unwrap();
        let default_names: Vec<_> = default_hits
            .iter()
            .filter_map(|hit| hit.path.file_name().and_then(|name| name.to_str()))
            .collect();
        assert_eq!(default_names, vec!["visible.md"]);

        let mut no_ignore_args = args(root.clone());
        no_ignore_args.no_ignore = Some(true);
        no_ignore_args.exclusions = Some(vec!["excluded.md".into()]);
        let no_ignore_hits = run_search(no_ignore_args).unwrap();
        let mut no_ignore_names: Vec<_> = no_ignore_hits
            .iter()
            .filter_map(|hit| hit.path.file_name().and_then(|name| name.to_str()))
            .collect();
        no_ignore_names.sort_unstable();
        assert_eq!(no_ignore_names, vec!["ignored.md", "visible.md"]);

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_missing_root_and_reports_match_column() {
        let missing =
            std::env::temp_dir().join(format!("marktext-search-missing-{}", uuid::Uuid::new_v4()));
        assert!(run_search(args(missing)).is_err());

        let root = std::env::temp_dir().join(format!("marktext-search-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("column.md"), "prefix needle").unwrap();
        let hits = run_search(args(root.clone())).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 1);
        assert_eq!(hits[0].column, 8);
        fs::remove_dir_all(root).unwrap();
    }
}
