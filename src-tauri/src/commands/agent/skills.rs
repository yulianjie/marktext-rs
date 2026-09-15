//! Skills are bounded text packages. Only the picker imports filesystem data;
//! the model can read named files in a frozen catalog, never arbitrary paths.
use super::failure;
use crate::{error::AppResult, filesystem::atomic_write};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, io::Read, path::Path};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

include!(concat!(env!("OUT_DIR"), "/agent_skills.rs"));
const MAX_FILE: usize = 100_000;
const MAX_PACKAGE: usize = 1_000_000;
const MAX_CUSTOM: usize = 30;
const MAX_SAVED: usize = 32_000_000;
static LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Clone, Serialize, Deserialize)]
struct Package {
    files: BTreeMap<String, String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    custom: Vec<Package>,
    disabled: Vec<String>,
}

#[derive(Deserialize)]
struct Frontmatter {
    name: String,
    description: String,
    license: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub license: Option<String>,
    pub source: Option<String>,
    pub builtin: bool,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct Skill {
    pub view: SkillView,
    package: Package,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && !path.contains(['\\', ':'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != ".." && !part.starts_with('.'))
}

fn parse(package: Package, builtin: bool) -> AppResult<Skill> {
    if package.files.len() > 128
        || package.files.values().map(String::len).sum::<usize>() > MAX_PACKAGE
        || package
            .files
            .iter()
            .any(|(path, text)| !valid_path(path) || text.len() > MAX_FILE || text.contains('\0'))
    {
        return Err(failure("skillInvalid"));
    }
    let text = package
        .files
        .get("SKILL.md")
        .ok_or_else(|| failure("skillInvalid"))?
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");
    let after = text
        .strip_prefix("---\n")
        .ok_or_else(|| failure("skillInvalid"))?;
    let (yaml, body) = after
        .split_once("\n---\n")
        .ok_or_else(|| failure("skillInvalid"))?;
    let meta: Frontmatter = serde_yaml_ng::from_str(yaml).map_err(|_| failure("skillInvalid"))?;
    if !valid_name(&meta.name)
        || meta.description.trim().is_empty()
        || meta.description.len() > 4096
        || body.trim().is_empty()
        || meta.license.as_ref().is_some_and(|s| s.len() > 300)
    {
        return Err(failure("skillInvalid"));
    }
    let source = if builtin {
        package
            .files
            .get("source.json")
            .and_then(|text| {
                serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).ok()
            })
            .and_then(|v| v["url"].as_str().map(String::from))
    } else {
        None
    };
    let license = {
        package.files.get("LICENSE.txt").and_then(|text| {
            if text.contains("MIT License") {
                Some("MIT".into())
            } else if text.contains("Apache License") {
                Some("Apache-2.0".into())
            } else {
                None
            }
        })
    }
    .or(meta.license);
    Ok(Skill {
        view: SkillView {
            id: format!("{}:{}", if builtin { "builtin" } else { "user" }, meta.name),
            name: meta.name,
            description: meta.description,
            license,
            source,
            builtin,
            enabled: true,
        },
        package,
    })
}

pub(super) fn bundled() -> AppResult<Vec<Skill>> {
    let mut packages: BTreeMap<&str, BTreeMap<String, String>> = BTreeMap::new();
    for (path, text) in BUNDLED_FILES {
        let Some((dir, path)) = path.split_once('/') else {
            continue;
        };
        packages
            .entry(dir)
            .or_default()
            .insert(path.into(), (*text).into());
    }
    packages
        .into_values()
        .map(|files| parse(Package { files }, true))
        .collect()
}

fn read_bounded(path: &Path, limit: usize) -> AppResult<String> {
    let file = fs::File::open(path).map_err(|_| failure("skillRead"))?;
    if !file.metadata().map_err(|_| failure("skillRead"))?.is_file() {
        return Err(failure("skillInvalid"));
    }
    let mut text = String::new();
    file.take((limit + 1) as u64)
        .read_to_string(&mut text)
        .map_err(|_| failure("skillRead"))?;
    if text.len() > limit {
        return Err(failure("skillLimit"));
    }
    Ok(text)
}

fn read_saved(path: &Path) -> AppResult<Saved> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Saved::default()),
        Err(_) => return Err(failure("skillRead")),
        Ok(_) => {}
    }
    let saved: Saved =
        serde_json::from_str(&read_bounded(path, MAX_SAVED)?).map_err(|_| failure("skillRead"))?;
    if saved.custom.len() > MAX_CUSTOM || saved.disabled.len() > MAX_CUSTOM + 20 {
        return Err(failure("skillLimit"));
    }
    Ok(saved)
}

fn catalog(saved: &Saved) -> AppResult<Vec<Skill>> {
    let mut skills = bundled()?;
    for package in &saved.custom {
        skills.push(parse(package.clone(), false)?);
    }
    for skill in &mut skills {
        skill.view.enabled = !saved.disabled.contains(&skill.view.id);
    }
    Ok(skills)
}

pub fn load(app: &AppHandle) -> AppResult<Vec<Skill>> {
    let _guard = LOCK.lock();
    catalog(&read_saved(
        &app.path().app_config_dir()?.join("agent-skills.json"),
    )?)
}

fn mutate(
    app: &AppHandle,
    change: impl FnOnce(&mut Saved) -> AppResult<()>,
) -> AppResult<Vec<SkillView>> {
    let _guard = LOCK.lock();
    let path = app.path().app_config_dir()?.join("agent-skills.json");
    let mut saved = read_saved(&path)?;
    change(&mut saved)?;
    let skills = catalog(&saved)?;
    let bytes = serde_json::to_vec_pretty(&saved).map_err(|_| failure("skillWrite"))?;
    if bytes.len() > MAX_SAVED {
        return Err(failure("skillLimit"));
    }
    atomic_write::write(&path, &bytes).map_err(|_| failure("skillWrite"))?;
    Ok(skills.into_iter().map(|skill| skill.view).collect())
}

fn import_package(path: &Path) -> AppResult<Package> {
    if path.file_name().and_then(|s| s.to_str()) != Some("SKILL.md") {
        return Err(failure("skillInvalid"));
    }
    let root = path
        .parent()
        .ok_or_else(|| failure("skillInvalid"))?
        .canonicalize()
        .map_err(|_| failure("skillRead"))?;
    let mut files = BTreeMap::new();
    let mut total = 0;
    // References/assets remain text. Scripts, hidden directories and links are never imported.
    for entry in walkdir::WalkDir::new(&root)
        .max_depth(8)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !e.file_name().to_string_lossy().starts_with('.') && e.file_name() != "scripts"
        })
    {
        let entry = entry.map_err(|_| failure("skillRead"))?;
        if entry.path_is_symlink() {
            return Err(failure("skillInvalid"));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|_| failure("skillInvalid"))?
            .to_string_lossy()
            .replace('\\', "/");
        let extension = entry
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "md" | "txt" | "mmd") && !relative.starts_with("LICENSE") {
            continue;
        }
        if !entry
            .path()
            .canonicalize()
            .map_err(|_| failure("skillRead"))?
            .starts_with(&root)
        {
            return Err(failure("skillInvalid"));
        }
        let text = read_bounded(entry.path(), MAX_FILE)?;
        total += text.len();
        if total > MAX_PACKAGE || files.len() >= 128 {
            return Err(failure("skillLimit"));
        }
        files.insert(relative, text);
    }
    let package = Package { files };
    parse(package.clone(), false)?;
    Ok(package)
}

fn add(saved: &mut Saved, package: Package) -> AppResult<()> {
    let skill = parse(package.clone(), false)?;
    if saved.custom.len() >= MAX_CUSTOM {
        return Err(failure("skillLimit"));
    }
    if catalog(saved)?.iter().any(|s| s.view.id == skill.view.id) {
        return Err(failure("skillExists"));
    }
    saved.custom.push(package);
    Ok(())
}

#[tauri::command]
pub async fn cmd_agent_list_skills(app: AppHandle) -> AppResult<Vec<SkillView>> {
    tokio::task::spawn_blocking(move || Ok(load(&app)?.into_iter().map(|s| s.view).collect()))
        .await
        .map_err(|_| failure("skillRead"))?
}

#[tauri::command]
pub async fn cmd_agent_import_skill(app: AppHandle) -> AppResult<Option<Vec<SkillView>>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Import SKILL.md")
        .add_filter("SKILL.md", &["md"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(path) = rx.await.map_err(|_| failure("skillRead"))? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| failure("skillRead"))?;
    tokio::task::spawn_blocking(move || {
        let package = import_package(&path)?;
        mutate(&app, |saved| add(saved, package)).map(Some)
    })
    .await
    .map_err(|_| failure("skillRead"))?
}

#[tauri::command]
pub async fn cmd_agent_set_skill_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> AppResult<Vec<SkillView>> {
    tokio::task::spawn_blocking(move || {
        mutate(&app, |saved| {
            if !catalog(saved)?.iter().any(|s| s.view.id == id) {
                return Err(failure("skillNotFound"));
            }
            saved.disabled.retain(|s| s != &id);
            if !enabled {
                saved.disabled.push(id);
            }
            Ok(())
        })
    })
    .await
    .map_err(|_| failure("skillWrite"))?
}

#[tauri::command]
pub async fn cmd_agent_remove_skill(app: AppHandle, id: String) -> AppResult<Vec<SkillView>> {
    tokio::task::spawn_blocking(move || {
        mutate(&app, |saved| {
            let index = saved
                .custom
                .iter()
                .position(|p| parse(p.clone(), false).is_ok_and(|s| s.view.id == id))
                .ok_or_else(|| failure("skillNotFound"))?;
            saved.custom.remove(index);
            saved.disabled.retain(|s| s != &id);
            Ok(())
        })
    })
    .await
    .map_err(|_| failure("skillWrite"))?
}

#[tauri::command]
pub async fn cmd_agent_read_skill(app: AppHandle, id: String) -> AppResult<Value> {
    tokio::task::spawn_blocking(move || {
        let skills = load(&app)?;
        let skill = skills
            .iter()
            .find(|s| s.view.id == id)
            .ok_or_else(|| failure("skillNotFound"))?;
        Ok(details(skill))
    })
    .await
    .map_err(|_| failure("skillRead"))?
}

fn details(skill: &Skill) -> Value {
    json!({"id":skill.view.id,"instructions":skill.package.files.get("SKILL.md"),
        "files":skill.package.files.keys().filter(|p| p.as_str() != "SKILL.md").collect::<Vec<_>>()})
}

pub fn execute(skills: &[Skill], name: &str, args: &str) -> Value {
    let Ok(args) = serde_json::from_str::<Value>(args) else {
        return json!({"error":"Invalid skill arguments."});
    };
    let Some(skill) = skills
        .iter()
        .find(|s| s.view.enabled && Some(s.view.id.as_str()) == args["id"].as_str())
    else {
        return json!({"error":"Skill unavailable or disabled. Use an enabled catalog id."});
    };
    if name == "read_skill" {
        return details(skill);
    }
    let Some(path) = args["path"].as_str().filter(|p| valid_path(p)) else {
        return json!({"error":"Use an exact relative file name from read_skill."});
    };
    match skill.package.files.get(path) {
        Some(text) => json!({"id":skill.view.id,"path":path,"text":text}),
        None => json!({"error":"This file is not part of the skill's text package."}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package() -> Package {
        Package { files: BTreeMap::from([
            ("SKILL.md".into(), "\u{feff}---\r\nname: sample\r\ndescription: >-\r\n  Explain technical\r\n  documentation.\r\nmetadata:\r\n  author: Tester\r\n---\r\nUse references/example.md for examples.\r\n".into()),
            ("references/example.md".into(), "A useful reference.".into()),
        ]) }
    }

    #[test]
    fn builtin_skills_have_provenance_licenses_and_references() {
        let skills = bundled().unwrap();
        assert_eq!(skills.len(), 6);
        for skill in &skills {
            assert!(skill.view.builtin && skill.view.enabled);
            assert!(skill.view.source.as_ref().unwrap().contains("/tree/"));
            assert!(skill.package.files.contains_key("LICENSE.txt"));
            assert_eq!(
                skill.view.license.as_deref(),
                Some(if skill.view.name == "internal-comms" {
                    "Apache-2.0"
                } else {
                    "MIT"
                })
            );
        }
        let mermaid = skills
            .iter()
            .find(|s| s.view.name == "mermaid-diagrams")
            .unwrap();
        for path in [
            "references/flowcharts.md",
            "references/sequence-diagrams.md",
            "references/erd-diagrams.md",
        ] {
            assert!(mermaid.package.files.contains_key(path));
        }
        let communications = skills
            .iter()
            .find(|s| s.view.name == "internal-comms")
            .unwrap();
        for path in [
            "examples/3p-updates.md",
            "examples/company-newsletter.md",
            "examples/faq-answers.md",
            "examples/general-comms.md",
        ] {
            assert!(communications.package.files.contains_key(path));
        }
        let coauthor = skills
            .iter()
            .find(|s| s.view.name == "markdown-coauthor")
            .unwrap();
        assert!(coauthor.package.files["SKILL.md"].len() < 5_000);
        assert!(!skills.iter().any(|s| s.view.name == "doc-coauthoring"));
    }

    #[test]
    fn parses_standard_yaml_and_enforces_scope_and_disable() {
        let mut skill = parse(package(), false).unwrap();
        assert_eq!(skill.view.description, "Explain technical documentation.");
        assert!(
            execute(&[skill.clone()], "read_skill", r#"{"id":"user:sample"}"#)["instructions"]
                .as_str()
                .unwrap()
                .contains("references/example.md")
        );
        for path in [
            "../secret.md",
            "C:\\secret.md",
            "references/../../secret.md",
            "other/SKILL.md",
        ] {
            assert!(execute(
                &[skill.clone()],
                "read_skill_file",
                &json!({"id":"user:sample","path":path}).to_string()
            )
            .get("error")
            .is_some());
        }
        assert_eq!(
            execute(
                &[skill.clone()],
                "read_skill_file",
                r#"{"id":"user:sample","path":"references/example.md"}"#
            )["text"],
            "A useful reference."
        );
        skill.view.enabled = false;
        assert!(execute(&[skill], "read_skill", r#"{"id":"user:sample"}"#)
            .get("error")
            .is_some());
        let mut invalid = package();
        invalid.files.insert("../secret.md".into(), "bad".into());
        assert!(parse(invalid, false).is_err());
    }

    #[test]
    fn import_copies_text_and_persists_without_executing_or_changing_source() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(source.join("references")).unwrap();
        fs::create_dir_all(source.join("scripts")).unwrap();
        for (path, text) in package().files {
            fs::write(source.join(path), text).unwrap();
        }
        fs::write(source.join("scripts/do.md"), "should not import").unwrap();
        fs::write(source.join("payload.exe"), "should not execute").unwrap();
        let package = import_package(&source.join("SKILL.md")).unwrap();
        assert_eq!(package.files.len(), 2);
        let mut saved = Saved::default();
        add(&mut saved, package.clone()).unwrap();
        assert!(add(&mut saved, package).is_err());
        saved.disabled.push("user:sample".into());
        let path = temp.path().join("config/agent-skills.json");
        atomic_write::write(&path, &serde_json::to_vec(&saved).unwrap()).unwrap();
        let mut reloaded = read_saved(&path).unwrap();
        assert!(
            !catalog(&reloaded)
                .unwrap()
                .iter()
                .find(|s| s.view.id == "user:sample")
                .unwrap()
                .view
                .enabled
        );
        reloaded.custom.clear();
        atomic_write::write(&path, &serde_json::to_vec(&reloaded).unwrap()).unwrap();
        assert_eq!(catalog(&read_saved(&path).unwrap()).unwrap().len(), 6);
        assert!(source.join("SKILL.md").exists());
        fs::write(source.join("references/large.md"), "x".repeat(MAX_FILE + 1)).unwrap();
        assert!(import_package(&source.join("SKILL.md")).is_err());
    }
}
