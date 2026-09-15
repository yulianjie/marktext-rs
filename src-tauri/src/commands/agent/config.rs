//! Non-secret settings on disk; credentials are scoped to the exact API base URL
//! in the OS credential store. Neither read commands nor errors expose secrets.
use super::failure;
use crate::{error::AppResult, filesystem::atomic_write};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use url::Url;

static CONFIG_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub base_url: String,
    pub model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-flash".into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    #[serde(flatten)]
    settings: Settings,
    has_key: bool,
}

pub fn validate(mut settings: Settings) -> AppResult<Settings> {
    let url = Url::parse(settings.base_url.trim()).map_err(|_| failure("invalidUrl"))?;
    let local = match url.host() {
        Some(url::Host::Domain(host)) => host == "localhost",
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    };
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.as_str().len() > 2048
        || url.path().ends_with("/chat/completions")
    {
        return Err(failure("invalidUrl"));
    }
    settings.base_url = url.as_str().trim_end_matches('/').to_string();
    settings.model = settings.model.trim().to_string();
    if settings.model.is_empty()
        || settings.model.len() > 200
        || settings.model.chars().any(char::is_control)
    {
        return Err(failure("invalidModel"));
    }
    Ok(settings)
}

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_config_dir()?.join("agent-settings.json"))
}

fn read(app: &AppHandle) -> AppResult<Settings> {
    let path = path(app)?;
    match fs::read(path) {
        Ok(bytes) => validate(serde_json::from_slice(&bytes).map_err(|_| failure("configRead"))?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(_) => Err(failure("configRead")),
    }
}

fn entry(settings: &Settings) -> AppResult<keyring::Entry> {
    keyring::Entry::new("app.marktext.agent", &settings.base_url).map_err(|_| failure("keychain"))
}

fn key(settings: &Settings) -> AppResult<Option<String>> {
    match entry(settings)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(failure("keychain")),
    }
}

pub fn get(app: &AppHandle) -> AppResult<ConfigView> {
    let _guard = CONFIG_LOCK.lock();
    let settings = read(app)?;
    let has_key = key(&settings)?.is_some();
    Ok(ConfigView { settings, has_key })
}

pub fn save(app: &AppHandle, settings: Settings, api_key: Option<String>) -> AppResult<ConfigView> {
    let _guard = CONFIG_LOCK.lock();
    let settings = validate(settings)?;
    let config_path = path(app)?;
    if let Some(secret) = api_key {
        if secret.len() > 4096 || secret.chars().any(char::is_control) {
            return Err(failure("invalidKey"));
        }
        let entry = entry(&settings)?;
        if secret.trim().is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => return Err(failure("keychain")),
            }
        } else {
            entry
                .set_password(secret.trim())
                .map_err(|_| failure("keychain"))?;
        }
    }
    atomic_write::write(&config_path, &serde_json::to_vec_pretty(&settings)?)
        .map_err(|_| failure("configWrite"))?;
    let has_key = key(&settings)?.is_some();
    Ok(ConfigView { settings, has_key })
}

pub fn credentials(app: &AppHandle) -> AppResult<(Settings, Option<String>)> {
    let _guard = CONFIG_LOCK.lock();
    let settings = read(app)?;
    let secret = key(&settings)?;
    Ok((settings, secret))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_cannot_carry_secrets_or_send_keys_over_remote_http() {
        for base_url in [
            "http://api.example.com",
            "https://user:pass@example.com",
            "https://a.com/?key=x",
            "https://a.com/#secret",
            "file:///tmp/api",
            "https://a.com/v1/chat/completions",
        ] {
            assert!(validate(Settings {
                base_url: base_url.into(),
                model: "model".into()
            })
            .is_err());
        }
        for base_url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1",
            "http://[::1]:11434/v1",
            "https://api.deepseek.com/",
        ] {
            assert!(validate(Settings {
                base_url: base_url.into(),
                model: "model".into()
            })
            .is_ok());
        }
    }
}
