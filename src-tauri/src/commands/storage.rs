//! Cloud-storage connection commands.
//!
//! Only non-secret metadata is persisted here. Passwords and tokens are held
//! by `storage::CredentialStore` and provider errors are deliberately reduced
//! to stable codes before they cross IPC.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    filesystem::atomic_write,
    storage::{
        git::{GitRepositoryConfig, GitStorage},
        plugin::{
            validate_plugin_configuration, PluginAllowlist, PluginProvider, StoragePluginManifest,
        },
        self_hosted::{SelfHostedConfig, SelfHostedProvider},
        sync::{OneShotSync, SyncAction, SyncConflictReason},
        webdav::{WebDavConfig, WebDavCredentials, WebDavProvider},
        CredentialStore, DynStorageProvider, ProviderCapabilities, SecretString, StorageError,
    },
};

const CONNECTIONS_FILE: &str = "storage-connections.json";
const PLUGIN_DIR: &str = "storage-plugins";
const MAX_CONNECTIONS_FILE_BYTES: u64 = 1024 * 1024;
const MAX_PLUGIN_CONFIG_BYTES: usize = 64 * 1024;
static CONNECTIONS_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionKind {
    SelfHosted,
    Git,
    #[serde(rename = "webdav")]
    WebDav,
    Plugin,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub kind: ConnectionKind,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub local_root: PathBuf,
    #[serde(default)]
    pub repository_path: Option<PathBuf>,
    #[serde(default)]
    pub remote: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub plugin_config: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedConnection {
    id: String,
    name: String,
    kind: ConnectionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_id: Option<String>,
    local_root: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    repository_path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plugin_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plugin_config: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionsFile {
    version: u8,
    connections: Vec<SavedConnection>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    id: String,
    name: String,
    kind: ConnectionKind,
    endpoint: Option<String>,
    username: Option<String>,
    workspace_id: Option<String>,
    local_root: PathBuf,
    repository_path: Option<PathBuf>,
    remote: Option<String>,
    branch: Option<String>,
    plugin_id: Option<String>,
    plugin_config: Option<String>,
    has_secret: bool,
    capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    ok: bool,
    message: String,
    capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    id: String,
    name: String,
    version: String,
    protocol_version: u16,
    capabilities: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictView {
    path: String,
    kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    state: String,
    uploaded: usize,
    downloaded: usize,
    conflicts: Vec<ConflictView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatusEvent {
    connection_id: String,
    #[serde(flatten)]
    result: SyncResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictView {
    path: String,
    stages: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncView {
    state: String,
    ahead: u32,
    behind: u32,
    conflicts: Vec<GitConflictView>,
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidArgument(message.to_owned())
}

fn storage_error(error: StorageError) -> AppError {
    AppError::Other(error.to_string())
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_config_dir()?.join(CONNECTIONS_FILE))
}

fn plugin_root(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_config_dir()?.join(PLUGIN_DIR))
}

fn read_file(path: &Path) -> AppResult<ConnectionsFile> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.len() > MAX_CONNECTIONS_FILE_BYTES => {
            return Err(invalid("storage connections file is too large"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConnectionsFile {
                version: 1,
                connections: Vec::new(),
            });
        }
        Err(error) => return Err(error.into()),
    }
    let parsed: ConnectionsFile = serde_json::from_slice(&std::fs::read(path)?)?;
    if parsed.version != 1 || parsed.connections.len() > 128 {
        return Err(invalid("unsupported storage connections file"));
    }
    let unique = parsed
        .connections
        .iter()
        .map(|item| item.id.as_str())
        .collect::<HashSet<_>>();
    if unique.len() != parsed.connections.len() {
        return Err(invalid("duplicate storage connection id"));
    }
    Ok(parsed)
}

fn write_file(path: &Path, file: &ConnectionsFile) -> AppResult<()> {
    atomic_write::write(path, &serde_json::to_vec_pretty(file)?)?;
    Ok(())
}

fn load_connections(app: &AppHandle) -> AppResult<ConnectionsFile> {
    let _guard = CONNECTIONS_LOCK.lock();
    read_file(&config_path(app)?)
}

fn capability_names(value: &ProviderCapabilities) -> Vec<String> {
    let mut result = Vec::new();
    if value.conditional_write {
        result.push("conditionalWrite".into());
    }
    if value.incremental_changes {
        result.push("incrementalChanges".into());
    }
    if value.atomic_move {
        result.push("atomicMove".into());
    }
    if value.version_history {
        result.push("versionHistory".into());
    }
    if value.stable_file_id {
        result.push("stableFileId".into());
    }
    result
}

fn connection_view(saved: &SavedConnection) -> ConnectionView {
    let has_secret = CredentialStore::new(saved.id.clone())
        .and_then(|store| store.read())
        .map(|secret| secret.is_some())
        .unwrap_or(false);
    ConnectionView {
        id: saved.id.clone(),
        name: saved.name.clone(),
        kind: saved.kind,
        endpoint: saved.endpoint.clone(),
        username: saved.username.clone(),
        workspace_id: saved.workspace_id.clone(),
        local_root: saved.local_root.clone(),
        repository_path: saved.repository_path.clone(),
        remote: saved.remote.clone(),
        branch: saved.branch.clone(),
        plugin_id: saved.plugin_id.clone(),
        plugin_config: saved.plugin_config.clone(),
        has_secret,
        capabilities: saved.capabilities.clone(),
    }
}

fn clean_optional(value: Option<String>, max: usize) -> AppResult<Option<String>> {
    match value.map(|value| value.trim().to_owned()) {
        Some(value) if value.is_empty() => Ok(None),
        Some(value) if value.len() > max || value.chars().any(char::is_control) => {
            Err(invalid("invalid storage connection field"))
        }
        value => Ok(value),
    }
}

fn normalize_input(
    input: ConnectionInput,
    existing: Option<&SavedConnection>,
) -> AppResult<SavedConnection> {
    let name = input.name.trim().to_owned();
    if name.is_empty() || name.len() > 120 || name.chars().any(char::is_control) {
        return Err(invalid("invalid storage connection name"));
    }
    if let Some(existing) = existing {
        if existing.kind != input.kind {
            return Err(invalid("storage connection kind cannot change"));
        }
    }
    let local_root = std::fs::canonicalize(&input.local_root)
        .map_err(|_| invalid("local working copy does not exist"))?;
    if !local_root.is_dir() {
        return Err(invalid("local working copy is not a directory"));
    }
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    crate::storage::validate_connection_id(&id).map_err(storage_error)?;
    let endpoint = clean_optional(input.endpoint, 2048)?;
    let username = clean_optional(input.username, 1024)?;
    let workspace_id = clean_optional(input.workspace_id, 128)?;
    let remote = clean_optional(input.remote, 128)?;
    let branch = clean_optional(input.branch, 256)?;
    let plugin_id = clean_optional(input.plugin_id, 120)?;
    let plugin_config = clean_optional(input.plugin_config, MAX_PLUGIN_CONFIG_BYTES)?;

    match input.kind {
        ConnectionKind::SelfHosted => {
            let base_url = endpoint
                .clone()
                .ok_or_else(|| invalid("self-hosted endpoint and workspace id are required"))?;
            let workspace_id = workspace_id
                .clone()
                .ok_or_else(|| invalid("self-hosted endpoint and workspace id are required"))?;
            SelfHostedConfig {
                base_url,
                workspace_id,
            }
            .validate()
            .map_err(storage_error)?;
        }
        ConnectionKind::WebDav => {
            let base_url = endpoint
                .clone()
                .ok_or_else(|| invalid("WebDAV endpoint and username are required"))?;
            if username.is_none() {
                return Err(invalid("WebDAV endpoint and username are required"));
            }
            WebDavConfig { base_url }
                .validate()
                .map_err(storage_error)?;
        }
        ConnectionKind::Git => {
            let remote_name = remote.as_deref().unwrap_or("origin");
            let branch_name = branch.as_deref().unwrap_or("main");
            if remote_name.starts_with('-')
                || !remote_name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
                || branch_name.starts_with('-')
                || branch_name.chars().any(char::is_control)
            {
                return Err(invalid("invalid Git remote or branch"));
            }
        }
        ConnectionKind::Plugin => {
            if plugin_id.is_none() {
                return Err(invalid("storage plugin is required"));
            }
        }
    }

    let repository_path = if input.kind == ConnectionKind::Git {
        let value = input
            .repository_path
            .ok_or_else(|| invalid("Git repository is required"))?;
        let canonical =
            std::fs::canonicalize(value).map_err(|_| invalid("Git repository does not exist"))?;
        if canonical != local_root {
            return Err(invalid("Git repository must match the local working copy"));
        }
        Some(canonical)
    } else {
        None
    };

    if let Some(config) = &plugin_config {
        let value: serde_json::Value = serde_json::from_str(config)
            .map_err(|_| invalid("plugin settings must be valid JSON"))?;
        let map = value
            .as_object()
            .ok_or_else(|| invalid("plugin settings must be a JSON object"))?;
        validate_plugin_configuration(map).map_err(storage_error)?;
    }

    Ok(SavedConnection {
        id,
        name,
        kind: input.kind,
        endpoint: if matches!(
            input.kind,
            ConnectionKind::SelfHosted | ConnectionKind::WebDav
        ) {
            endpoint
        } else {
            None
        },
        username: if input.kind == ConnectionKind::WebDav {
            username
        } else {
            None
        },
        workspace_id: if input.kind == ConnectionKind::SelfHosted {
            workspace_id
        } else {
            None
        },
        local_root,
        repository_path,
        remote: if input.kind == ConnectionKind::Git {
            remote.or_else(|| Some("origin".into()))
        } else {
            None
        },
        branch: if input.kind == ConnectionKind::Git {
            branch.or_else(|| Some("main".into()))
        } else {
            None
        },
        plugin_id: if input.kind == ConnectionKind::Plugin {
            plugin_id
        } else {
            None
        },
        plugin_config: if input.kind == ConnectionKind::Plugin {
            plugin_config
        } else {
            None
        },
        capabilities: existing
            .map(|item| item.capabilities.clone())
            .unwrap_or_default(),
    })
}

fn selected_secret(connection_id: &str, transient: Option<String>) -> AppResult<SecretString> {
    if let Some(secret) = transient.filter(|secret| !secret.is_empty()) {
        return SecretString::new(secret).map_err(storage_error);
    }
    CredentialStore::new(connection_id.to_owned())
        .and_then(|store| store.read())
        .map_err(storage_error)?
        .ok_or_else(|| invalid("storage credential is required"))
}

fn plugin_manifest_path(app: &AppHandle, plugin_id: &str) -> AppResult<(PathBuf, PluginAllowlist)> {
    crate::storage::validate_connection_id(plugin_id).map_err(storage_error)?;
    let root = plugin_root(app)?;
    let allowlist = PluginAllowlist::new(vec![root.clone()]).map_err(storage_error)?;
    Ok((root.join(plugin_id).join("storage-plugin.json"), allowlist))
}

fn plugin_configuration(
    saved: &SavedConnection,
) -> AppResult<serde_json::Map<String, serde_json::Value>> {
    let value = saved.plugin_config.as_deref().unwrap_or("{}");
    serde_json::from_str::<serde_json::Value>(value)?
        .as_object()
        .cloned()
        .ok_or_else(|| invalid("plugin settings must be a JSON object"))
}

fn build_provider(
    app: &AppHandle,
    saved: &SavedConnection,
    transient_secret: Option<String>,
) -> AppResult<Box<DynStorageProvider>> {
    match saved.kind {
        ConnectionKind::SelfHosted => {
            let provider = SelfHostedProvider::new(
                SelfHostedConfig {
                    base_url: saved
                        .endpoint
                        .clone()
                        .ok_or_else(|| invalid("missing endpoint"))?,
                    workspace_id: saved
                        .workspace_id
                        .clone()
                        .ok_or_else(|| invalid("missing workspace id"))?,
                },
                selected_secret(&saved.id, transient_secret)?,
            )
            .map_err(storage_error)?;
            Ok(Box::new(provider))
        }
        ConnectionKind::WebDav => {
            let password = selected_secret(&saved.id, transient_secret)?;
            let provider = WebDavProvider::new(
                WebDavConfig {
                    base_url: saved
                        .endpoint
                        .clone()
                        .ok_or_else(|| invalid("missing endpoint"))?,
                },
                WebDavCredentials {
                    username: saved
                        .username
                        .clone()
                        .ok_or_else(|| invalid("missing username"))?,
                    password: password.expose().to_owned(),
                },
            )
            .map_err(storage_error)?;
            Ok(Box::new(provider))
        }
        ConnectionKind::Plugin => {
            let plugin_id = saved
                .plugin_id
                .as_deref()
                .ok_or_else(|| invalid("missing plugin id"))?;
            let (manifest, allowlist) = plugin_manifest_path(app, plugin_id)?;
            let credential = match transient_secret {
                Some(secret) if !secret.is_empty() => {
                    Some(SecretString::new(secret).map_err(storage_error)?)
                }
                _ => CredentialStore::new(saved.id.clone())
                    .and_then(|store| store.read())
                    .map_err(storage_error)?,
            };
            let provider = PluginProvider::load(manifest, &allowlist)
                .map_err(storage_error)?
                .with_credential(credential)
                .with_configuration(plugin_configuration(saved)?)
                .map_err(storage_error)?;
            Ok(Box::new(provider))
        }
        ConnectionKind::Git => Err(invalid("Git uses the dedicated sync command")),
    }
}

#[tauri::command]
pub async fn cmd_storage_list_connections(app: AppHandle) -> AppResult<Vec<ConnectionView>> {
    tokio::task::spawn_blocking(move || {
        Ok(load_connections(&app)?
            .connections
            .iter()
            .map(connection_view)
            .collect())
    })
    .await
    .map_err(|_| AppError::Other("storage worker failed".into()))?
}

#[tauri::command]
pub async fn cmd_storage_save_connection(
    app: AppHandle,
    connection: ConnectionInput,
    secret: Option<String>,
) -> AppResult<ConnectionView> {
    tokio::task::spawn_blocking(move || {
        let _guard = CONNECTIONS_LOCK.lock();
        let path = config_path(&app)?;
        let mut file = read_file(&path)?;
        let existing_index = connection
            .id
            .as_deref()
            .and_then(|id| file.connections.iter().position(|item| item.id == id));
        let saved = normalize_input(
            connection,
            existing_index.map(|index| &file.connections[index]),
        )?;
        if let Some(secret) = secret.filter(|secret| !secret.is_empty()) {
            let secret = SecretString::new(secret).map_err(storage_error)?;
            CredentialStore::new(saved.id.clone())
                .and_then(|store| store.write(&secret))
                .map_err(storage_error)?;
        }
        if let Some(index) = existing_index {
            file.connections[index] = saved.clone();
        } else {
            file.connections.push(saved.clone());
        }
        write_file(&path, &file)?;
        Ok(connection_view(&saved))
    })
    .await
    .map_err(|_| AppError::Other("storage worker failed".into()))?
}

#[tauri::command]
pub async fn cmd_storage_delete_connection(app: AppHandle, id: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || {
        crate::storage::validate_connection_id(&id).map_err(storage_error)?;
        let _guard = CONNECTIONS_LOCK.lock();
        let path = config_path(&app)?;
        let mut file = read_file(&path)?;
        let old_len = file.connections.len();
        file.connections.retain(|item| item.id != id);
        if old_len == file.connections.len() {
            return Err(AppError::NotFound("storage connection".into()));
        }
        write_file(&path, &file)?;
        CredentialStore::new(id)
            .and_then(|store| store.delete())
            .map_err(storage_error)
    })
    .await
    .map_err(|_| AppError::Other("storage worker failed".into()))?
}

#[tauri::command]
pub async fn cmd_storage_probe_connection(
    app: AppHandle,
    connection: ConnectionInput,
    secret: Option<String>,
) -> AppResult<ProbeResult> {
    let existing = load_connections(&app)?;
    let matched = connection
        .id
        .as_deref()
        .and_then(|id| existing.connections.iter().find(|item| item.id == id));
    let saved = normalize_input(connection, matched)?;
    let capabilities = if saved.kind == ConnectionKind::Git {
        let git = GitStorage::open(GitRepositoryConfig {
            repository_path: saved
                .repository_path
                .clone()
                .ok_or_else(|| invalid("missing Git repository"))?,
            remote: saved.remote.clone().unwrap_or_else(|| "origin".into()),
            branch: saved.branch.clone().unwrap_or_else(|| "main".into()),
        })
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
        git.status()
            .await
            .map_err(|error| AppError::Other(error.to_string()))?;
        vec!["versionHistory".into(), "stableFileId".into()]
    } else {
        let provider = build_provider(&app, &saved, secret)?;
        capability_names(&provider.probe().await.map_err(storage_error)?)
    };
    Ok(ProbeResult {
        ok: true,
        message: "storage:connectionOk".into(),
        capabilities,
    })
}

#[tauri::command]
pub async fn cmd_storage_list_plugins(app: AppHandle) -> AppResult<Vec<PluginView>> {
    tokio::task::spawn_blocking(move || {
        let root = plugin_root(&app)?;
        if !root.exists() {
            return Ok(Vec::new());
        }
        let allowlist = PluginAllowlist::new(vec![root.clone()]).map_err(storage_error)?;
        let mut plugins = Vec::new();
        for entry in std::fs::read_dir(&root)? {
            let Ok(entry) = entry else { continue };
            let manifest_path = entry.path().join("storage-plugin.json");
            let Ok(provider) = PluginProvider::load(manifest_path, &allowlist) else {
                continue;
            };
            let manifest: &StoragePluginManifest = provider.manifest();
            plugins.push(PluginView {
                id: manifest.id.clone(),
                name: manifest.display_name.clone(),
                version: manifest.version.clone(),
                protocol_version: manifest.protocol_version,
                capabilities: capability_names(&manifest.capabilities),
            });
        }
        plugins.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(plugins)
    })
    .await
    .map_err(|_| AppError::Other("storage worker failed".into()))?
}

fn find_saved(app: &AppHandle, id: &str) -> AppResult<SavedConnection> {
    crate::storage::validate_connection_id(id).map_err(storage_error)?;
    load_connections(app)?
        .connections
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound("storage connection".into()))
}

#[tauri::command]
pub async fn cmd_storage_sync(app: AppHandle, id: String) -> AppResult<SyncResult> {
    let saved = find_saved(&app, &id)?;
    if saved.kind == ConnectionKind::Git {
        return Err(invalid("use Git sync for Git connections"));
    }
    let provider = build_provider(&app, &saved, None)?;
    let sync = OneShotSync::new(provider.as_ref(), &saved.local_root).map_err(storage_error)?;
    let outcome = sync
        .apply(sync.plan().await.map_err(storage_error)?)
        .await
        .map_err(storage_error)?;
    let uploaded = outcome
        .applied
        .iter()
        .filter(|action| matches!(action, SyncAction::Upload { .. }))
        .count();
    let downloaded = outcome
        .applied
        .iter()
        .filter(|action| matches!(action, SyncAction::Download { .. }))
        .count();
    let conflicts = outcome
        .conflicts
        .into_iter()
        .map(|conflict| ConflictView {
            path: conflict.path.as_str().to_owned(),
            kind: match conflict.reason {
                SyncConflictReason::LocalChangedRemoteDeleted
                | SyncConflictReason::LocalDeletedRemoteChanged => "deleteEdit",
                _ => "content",
            }
            .into(),
        })
        .collect::<Vec<_>>();
    let result = SyncResult {
        state: if conflicts.is_empty() {
            "synced"
        } else {
            "conflict"
        }
        .into(),
        uploaded,
        downloaded,
        conflicts,
        message: None,
    };
    app.emit(
        "mt://storage/status",
        StorageStatusEvent {
            connection_id: id,
            result: result.clone(),
        },
    )?;
    Ok(result)
}

fn git_conflicts(state: &crate::storage::git::GitRepositoryState) -> Vec<GitConflictView> {
    state
        .conflicts
        .iter()
        .map(|conflict| GitConflictView {
            path: conflict.path.clone(),
            stages: conflict.stages.iter().map(|stage| stage.stage).collect(),
        })
        .collect()
}

async fn git_for(saved: &SavedConnection) -> AppResult<GitStorage> {
    GitStorage::open(GitRepositoryConfig {
        repository_path: saved
            .repository_path
            .clone()
            .ok_or_else(|| invalid("missing Git repository"))?,
        remote: saved.remote.clone().unwrap_or_else(|| "origin".into()),
        branch: saved.branch.clone().unwrap_or_else(|| "main".into()),
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))
}

fn emit_git_status(app: &AppHandle, id: &str, view: &GitSyncView) -> AppResult<()> {
    let conflicts = view
        .conflicts
        .iter()
        .map(|conflict| ConflictView {
            path: conflict.path.clone(),
            kind: "git".into(),
        })
        .collect::<Vec<_>>();
    let state = match view.state.as_str() {
        "conflicts" => "conflict",
        "diverged" | "mergeReady" => "pending",
        _ => "synced",
    };
    app.emit(
        "mt://storage/status",
        StorageStatusEvent {
            connection_id: id.to_owned(),
            result: SyncResult {
                state: state.into(),
                uploaded: 0,
                downloaded: 0,
                conflicts,
                message: None,
            },
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_storage_git_sync(app: AppHandle, id: String) -> AppResult<GitSyncView> {
    let saved = find_saved(&app, &id)?;
    if saved.kind != ConnectionKind::Git {
        return Err(invalid("not a Git connection"));
    }
    let git = git_for(&saved).await?;
    let before = git
        .status()
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    if !before.conflicts.is_empty() || before.operation_in_progress.is_some() {
        let view = GitSyncView {
            state: "conflicts".into(),
            ahead: before.ahead,
            behind: before.behind,
            conflicts: git_conflicts(&before),
        };
        emit_git_status(&app, &id, &view)?;
        return Ok(view);
    }
    if !before.clean {
        return Err(AppError::Other("git:unsafeState".into()));
    }
    let fetched = git
        .fetch()
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    let (state_label, state) = if fetched.ahead > 0 && fetched.behind > 0 {
        let view = GitSyncView {
            state: "diverged".into(),
            ahead: fetched.ahead,
            behind: fetched.behind,
            conflicts: Vec::new(),
        };
        emit_git_status(&app, &id, &view)?;
        return Ok(view);
    } else if fetched.behind > 0 {
        (
            "updated",
            git.pull_fast_forward()
                .await
                .map_err(|error| AppError::Other(error.to_string()))?,
        )
    } else if fetched.ahead > 0 {
        (
            "pushed",
            git.push()
                .await
                .map_err(|error| AppError::Other(error.to_string()))?,
        )
    } else {
        ("upToDate", fetched)
    };
    let view = GitSyncView {
        state: state_label.into(),
        ahead: state.ahead,
        behind: state.behind,
        conflicts: git_conflicts(&state),
    };
    emit_git_status(&app, &id, &view)?;
    Ok(view)
}

#[tauri::command]
pub async fn cmd_storage_git_prepare_merge(app: AppHandle, id: String) -> AppResult<GitSyncView> {
    let saved = find_saved(&app, &id)?;
    if saved.kind != ConnectionKind::Git {
        return Err(invalid("not a Git connection"));
    }
    let git = git_for(&saved).await?;
    let state = git
        .merge_remote_for_review()
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    let view = GitSyncView {
        state: if state.conflicts.is_empty() {
            "mergeReady"
        } else {
            "conflicts"
        }
        .into(),
        ahead: state.ahead,
        behind: state.behind,
        conflicts: git_conflicts(&state),
    };
    emit_git_status(&app, &id, &view)?;
    Ok(view)
}

#[tauri::command]
pub async fn cmd_storage_git_conflict_stage(
    app: AppHandle,
    id: String,
    path: String,
    stage: u8,
) -> AppResult<String> {
    let saved = find_saved(&app, &id)?;
    if saved.kind != ConnectionKind::Git {
        return Err(invalid("not a Git connection"));
    }
    git_for(&saved)
        .await?
        .read_conflict_stage_text(&path, stage)
        .await
        .map_err(|error| AppError::Other(error.to_string()))
}

#[tauri::command]
pub async fn cmd_storage_git_abort(app: AppHandle, id: String) -> AppResult<()> {
    let saved = find_saved(&app, &id)?;
    if saved.kind != ConnectionKind::Git {
        return Err(invalid("not a Git connection"));
    }
    git_for(&saved)
        .await?
        .abort_in_progress()
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    app.emit(
        "mt://storage/status",
        StorageStatusEvent {
            connection_id: id,
            result: SyncResult {
                state: "pending".into(),
                uploaded: 0,
                downloaded: 0,
                conflicts: Vec::new(),
                message: None,
            },
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(root: &Path, kind: ConnectionKind) -> ConnectionInput {
        ConnectionInput {
            id: None,
            name: "test".into(),
            kind,
            endpoint: None,
            username: None,
            workspace_id: None,
            local_root: root.to_path_buf(),
            repository_path: None,
            remote: None,
            branch: None,
            plugin_id: None,
            plugin_config: None,
        }
    }

    #[test]
    fn connection_json_never_contains_a_secret_field() {
        let saved = SavedConnection {
            id: "id".into(),
            name: "test".into(),
            kind: ConnectionKind::WebDav,
            endpoint: Some("https://example.test/dav/".into()),
            username: Some("alice".into()),
            workspace_id: None,
            local_root: PathBuf::from("root"),
            repository_path: None,
            remote: None,
            branch: None,
            plugin_id: None,
            plugin_config: None,
            capabilities: Vec::new(),
        };
        let value = serde_json::to_value(saved).unwrap();
        let rendered = value.to_string().to_ascii_lowercase();
        assert!(!rendered.contains("password"));
        assert!(!rendered.contains("token"));
        assert!(!rendered.contains("secret"));
    }

    #[test]
    fn provider_schema_discards_irrelevant_fields_before_persistence() {
        let root = tempfile::tempdir().unwrap();
        let mut value = input(root.path(), ConnectionKind::Plugin);
        value.endpoint = Some("https://user:must-not-persist@example.test".into());
        value.username = Some("unused".into());
        value.workspace_id = Some("unused".into());
        value.plugin_id = Some("example".into());
        value.plugin_config = Some("{}".into());

        let saved = normalize_input(value, None).unwrap();
        assert_eq!(saved.endpoint, None);
        assert_eq!(saved.username, None);
        assert_eq!(saved.workspace_id, None);
        assert_eq!(saved.remote, None);
        assert_eq!(saved.branch, None);
        assert_eq!(saved.plugin_id.as_deref(), Some("example"));
        assert!(!serde_json::to_string(&saved)
            .unwrap()
            .contains("must-not-persist"));
    }

    #[test]
    fn embedded_url_credentials_are_rejected_before_save() {
        let root = tempfile::tempdir().unwrap();
        let mut value = input(root.path(), ConnectionKind::SelfHosted);
        value.endpoint = Some("https://user:secret@example.test/".into());
        value.workspace_id = Some("notes".into());
        assert!(normalize_input(value, None).is_err());
    }
}
