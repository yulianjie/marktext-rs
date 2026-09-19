//! WebDAV implementation of the local-first storage contract.
//!
//! Redirects are disabled so Basic credentials are never replayed to a second
//! host.  XML is parsed with a pull parser; document type declarations are
//! rejected and no external entities are resolved.

use super::{
    ChangeKind, ChangePage, ConditionalDelete, ConditionalMove, ConditionalWrite,
    ProviderCapabilities, ProviderKind, RemoteChange, RemoteContent, RemoteEntry, RemoteEntryKind,
    RemotePath, RemoteVersion, SecretString, StorageError, StorageErrorCode, StorageProvider,
    StorageResult, WritePrecondition,
};
use async_trait::async_trait;
use futures_util::StreamExt;
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use quick_xml::{events::Event, Reader};
use reqwest::{header, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{io::Cursor, time::Duration};

const MAX_XML_BYTES: usize = 4 * 1024 * 1024;
const MAX_CONTENT_BYTES: usize = 64 * 1024 * 1024;
const DAV_DEPTH: &str = "Depth";
const DAV_DESTINATION: &str = "Destination";
const DAV_OVERWRITE: &str = "Overwrite";
const DAV_SYNC_TOKEN: &str = "Sync-Token";
const DAV_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'!')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'\'')
    .add(b'(')
    .add(b')')
    .add(b'*')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebDavConfig {
    /// The collection root, for example
    /// `https://cloud.example.test/remote.php/dav/files/alice/Notes/`.
    pub base_url: String,
}

impl WebDavConfig {
    pub fn validate(&self) -> StorageResult<Url> {
        let mut url =
            Url::parse(self.base_url.trim()).map_err(|_| StorageError::invalid_config())?;
        let is_loopback = url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
        });
        if !matches!(url.scheme(), "https") && !(url.scheme() == "http" && is_loopback)
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.as_str().len() > 2048
        {
            return Err(StorageError::invalid_config());
        }
        if !url.path().ends_with('/') {
            let path = format!("{}/", url.path());
            url.set_path(&path);
        }
        Ok(url)
    }
}

/// Stored as one JSON value in `CredentialStore`; never part of WebDavConfig.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebDavCredentials {
    pub username: String,
    pub password: String,
}

impl WebDavCredentials {
    pub fn validate(self) -> StorageResult<Self> {
        if self.username.is_empty()
            || self.username.len() > 1024
            || self.password.is_empty()
            || self.password.len() > 16 * 1024
            || self.username.chars().any(char::is_control)
            || self.password.chars().any(char::is_control)
        {
            return Err(StorageError::invalid_config());
        }
        Ok(self)
    }

    pub fn to_secret(&self) -> StorageResult<SecretString> {
        SecretString::new(serde_json::to_string(self).map_err(|_| StorageError::invalid_config())?)
    }

    pub fn from_secret(secret: &SecretString) -> StorageResult<Self> {
        serde_json::from_str::<Self>(secret.expose())
            .map_err(|_| StorageError::new(StorageErrorCode::Credential))?
            .validate()
    }
}

impl std::fmt::Debug for WebDavCredentials {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WebDavCredentials")
            .field("username", &"[redacted]")
            .field("password", &"[redacted]")
            .finish()
    }
}

pub struct WebDavProvider {
    base_url: Url,
    credentials: WebDavCredentials,
    client: reqwest::Client,
}

impl std::fmt::Debug for WebDavProvider {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WebDavProvider")
            .field("base_url", &self.base_url)
            .field("credentials", &"[redacted]")
            .finish_non_exhaustive()
    }
}

impl WebDavProvider {
    pub fn new(config: WebDavConfig, credentials: WebDavCredentials) -> StorageResult<Self> {
        let base_url = config.validate()?;
        let credentials = credentials.validate()?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(45))
            .build()
            .map_err(|_| StorageError::new(StorageErrorCode::Unavailable))?;
        Ok(Self {
            base_url,
            credentials,
            client,
        })
    }

    fn url_for(&self, path: &RemotePath) -> StorageResult<Url> {
        if path.is_root() {
            return Ok(self.base_url.clone());
        }
        // Encode every segment independently.  This prevents a filename with
        // `?`, `#`, `%2f`, or `..` from changing the collection URL.
        let suffix = path
            .segments()
            .map(|segment| utf8_percent_encode(segment, DAV_SEGMENT_ENCODE_SET).to_string())
            .collect::<Vec<_>>()
            .join("/");
        Url::parse(&format!("{}{}", self.base_url.as_str(), suffix))
            .map_err(|_| StorageError::invalid_path())
    }

    fn request(&self, method: Method, url: Url) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> StorageResult<reqwest::Response> {
        request.send().await.map_err(map_reqwest_error)
    }

    fn response_version(response: &reqwest::Response) -> StorageResult<RemoteVersion> {
        let value = response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(StorageError::invalid_response)?;
        Self::strong_version(&RemoteVersion::new(value.to_owned())?)
    }

    fn strong_version(version: &RemoteVersion) -> StorageResult<RemoteVersion> {
        // RFC 9110 weak validators deliberately cannot be used with If-Match.
        // A missing or weak ETag is never a safe optimistic-concurrency token.
        let value = version.opaque.trim();
        if value.is_empty()
            || value.len() != version.opaque.len()
            || value
                .get(..2)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("W/"))
        {
            return Err(StorageError::invalid_response());
        }
        Ok(version.clone())
    }

    fn optional_strong_version(value: Option<String>) -> Option<RemoteVersion> {
        value
            .and_then(|value| RemoteVersion::new(value).ok())
            .and_then(|version| Self::strong_version(&version).ok())
    }

    fn ensure_status(status: StatusCode) -> StorageResult<()> {
        if status.is_success() {
            return Ok(());
        }
        Err(map_status(status))
    }

    async fn dav_response(
        &self,
        request: reqwest::RequestBuilder,
    ) -> StorageResult<Vec<DavResponse>> {
        let response = self.send(request).await?;
        if response.status() != StatusCode::MULTI_STATUS {
            return Err(map_status(response.status()));
        }
        parse_multistatus(&read_limited_body(response, MAX_XML_BYTES).await?)
    }

    fn href_to_path(&self, href: &str) -> StorageResult<RemotePath> {
        let response_url = self
            .base_url
            .join(href)
            .map_err(|_| StorageError::invalid_response())?;
        if response_url.scheme() != self.base_url.scheme()
            || response_url.host_str() != self.base_url.host_str()
            || response_url.port_or_known_default() != self.base_url.port_or_known_default()
        {
            return Err(StorageError::invalid_response());
        }
        let base = self.base_url.path();
        let target = response_url.path();
        let relative = target
            .strip_prefix(base)
            .ok_or_else(StorageError::invalid_response)?;
        let decoded_segments = relative
            .trim_matches('/')
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(|segment| {
                percent_decode_str(segment)
                    .decode_utf8()
                    .map(|value| value.into_owned())
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| StorageError::invalid_response())?;
        if decoded_segments
            .iter()
            .any(|segment| segment.contains('/') || segment.contains('\\'))
        {
            return Err(StorageError::invalid_response());
        }
        RemotePath::new(decoded_segments.join("/"))
    }

    async fn probe_strong_etag(&self) -> StorageResult<bool> {
        let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>"#;
        let request = self
            .request(
                Method::from_bytes(b"PROPFIND").expect("valid method"),
                self.base_url.clone(),
            )
            .header(DAV_DEPTH, "0")
            .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(body);
        let responses = self.dav_response(request).await?;
        Ok(responses.into_iter().any(|response| {
            self.href_to_path(&response.href)
                .ok()
                .is_some_and(|path| path.is_root())
                && Self::optional_strong_version(response.etag).is_some()
        }))
    }

    fn entry_from_response(&self, response: DavResponse) -> StorageResult<RemoteEntry> {
        let path = self.href_to_path(&response.href)?;
        Ok(RemoteEntry {
            path,
            kind: if response.is_collection {
                RemoteEntryKind::Directory
            } else {
                RemoteEntryKind::File
            },
            version: if response.is_collection {
                response.etag.and_then(|etag| RemoteVersion::new(etag).ok())
            } else {
                Self::optional_strong_version(response.etag)
            },
            remote_id: None,
            content_hash: None,
            size: response.size,
        })
    }
}

#[async_trait]
impl StorageProvider for WebDavProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::WebDav
    }

    async fn probe(&self) -> StorageResult<ProviderCapabilities> {
        let response = self
            .send(self.request(Method::OPTIONS, self.base_url.clone()))
            .await?;
        // A few older DAV servers return 405 to OPTIONS while still supporting
        // the required DAV methods; make that a useful compatibility result.
        if !(response.status().is_success() || response.status() == StatusCode::METHOD_NOT_ALLOWED)
        {
            return Err(map_status(response.status()));
        }
        let dav = response
            .headers()
            .get("DAV")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        let allow = response
            .headers()
            .get(header::ALLOW)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        // OPTIONS advertises methods, not whether the server actually honors
        // If-Match.  Require a depth-zero property response with a strong
        // validator before promising compare-and-swap to the sync engine.
        // Servers that cannot provide it remain usable for read-only/manual
        // workflows but cannot be auto-mutated.
        let conditional_write = match self.probe_strong_etag().await {
            Ok(value) => value,
            Err(error)
                if matches!(
                    error.code,
                    StorageErrorCode::Unsupported
                        | StorageErrorCode::InvalidResponse
                        | StorageErrorCode::NotFound
                ) =>
            {
                false
            }
            Err(error) => return Err(error),
        };
        Ok(ProviderCapabilities {
            conditional_write,
            incremental_changes: dav
                .split(',')
                .any(|value| value.trim().eq_ignore_ascii_case("sync-collection")),
            atomic_move: allow.to_ascii_uppercase().contains("MOVE") || dav.contains('2'),
            version_history: false,
            stable_file_id: false,
            case_sensitive: true,
            max_object_size: None,
        })
    }

    async fn list(&self, path: &RemotePath) -> StorageResult<Vec<RemoteEntry>> {
        let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/></d:prop></d:propfind>"#;
        let request = self
            .request(
                Method::from_bytes(b"PROPFIND").expect("valid method"),
                self.url_for(path)?,
            )
            .header(DAV_DEPTH, "1")
            .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(body);
        self.dav_response(request)
            .await?
            .into_iter()
            .filter(|entry| {
                entry
                    .status
                    .map_or(true, |status| (200..300).contains(&status))
            })
            .map(|entry| self.entry_from_response(entry))
            // A depth-1 PROPFIND echoes the directory itself.  Callers only
            // need its direct children.
            .filter(|entry| entry.as_ref().map_or(true, |entry| &entry.path != path))
            .collect()
    }

    async fn read(&self, path: &RemotePath) -> StorageResult<RemoteContent> {
        if path.is_root() {
            return Err(StorageError::invalid_path());
        }
        let response = self
            .send(self.request(Method::GET, self.url_for(path)?))
            .await?;
        Self::ensure_status(response.status())?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CONTENT_BYTES as u64)
        {
            return Err(StorageError::new(StorageErrorCode::InvalidResponse));
        }
        let version = response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(|value| RemoteVersion::new(value.to_owned()))
            .transpose()?
            .map(|version| Self::strong_version(&version))
            .transpose()?;
        let bytes = read_limited_body(response, MAX_CONTENT_BYTES).await?;
        Ok(RemoteContent {
            bytes: bytes.to_vec(),
            version,
        })
    }

    async fn write(&self, request: ConditionalWrite) -> StorageResult<RemoteVersion> {
        if request.path.is_root() {
            return Err(StorageError::invalid_path());
        }
        let mut request_builder = self
            .request(Method::PUT, self.url_for(&request.path)?)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(request.bytes);
        request_builder = match request.precondition {
            WritePrecondition::Match(version) => {
                request_builder.header(header::IF_MATCH, Self::strong_version(&version)?.opaque)
            }
            WritePrecondition::Missing => request_builder.header(header::IF_NONE_MATCH, "*"),
            WritePrecondition::None => {
                return Err(StorageError::new(StorageErrorCode::InvalidConfig))
            }
        };
        let response = self.send(request_builder).await?;
        Self::ensure_status(response.status())?;
        Self::response_version(&response)
    }

    async fn create_dir(&self, path: &RemotePath) -> StorageResult<RemoteVersion> {
        if path.is_root() {
            return Err(StorageError::invalid_path());
        }
        let response = self
            .send(self.request(
                Method::from_bytes(b"MKCOL").expect("valid method"),
                self.url_for(path)?,
            ))
            .await?;
        if response.status() == StatusCode::METHOD_NOT_ALLOWED
            || response.status() == StatusCode::CONFLICT
        {
            return Err(StorageError::new(StorageErrorCode::Conflict));
        }
        Self::ensure_status(response.status())?;
        // RFC 4918 does not require an ETag on MKCOL.  The empty opaque
        // marker means "created" and is never used as an update precondition.
        response
            .headers()
            .get(header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(|value| RemoteVersion::new(value.to_owned()))
            .transpose()?
            .or_else(|| RemoteVersion::new("created").ok())
            .ok_or_else(StorageError::invalid_response)
    }

    async fn move_entry(&self, request: ConditionalMove) -> StorageResult<RemoteVersion> {
        if request.from.is_root() || request.to.is_root() {
            return Err(StorageError::invalid_path());
        }
        let destination = self.url_for(&request.to)?;
        let mut request_builder = self
            .request(
                Method::from_bytes(b"MOVE").expect("valid method"),
                self.url_for(&request.from)?,
            )
            .header(DAV_DESTINATION, destination.as_str())
            .header(DAV_OVERWRITE, if request.overwrite { "T" } else { "F" });
        let source_version = request
            .expected_source
            .ok_or_else(StorageError::invalid_config)?;
        request_builder = request_builder.header(
            header::IF_MATCH,
            Self::strong_version(&source_version)?.opaque,
        );
        let response = self.send(request_builder).await?;
        Self::ensure_status(response.status())?;
        Self::response_version(&response)
    }

    async fn delete(&self, request: ConditionalDelete) -> StorageResult<()> {
        if request.path.is_root() {
            return Err(StorageError::invalid_path());
        }
        let mut request_builder = self.request(Method::DELETE, self.url_for(&request.path)?);
        let expected = request.expected.ok_or_else(StorageError::invalid_config)?;
        request_builder =
            request_builder.header(header::IF_MATCH, Self::strong_version(&expected)?.opaque);
        let response = self.send(request_builder).await?;
        Self::ensure_status(response.status())
    }

    async fn changes(&self, cursor: Option<&str>) -> StorageResult<ChangePage> {
        let token = cursor.ok_or_else(StorageError::unsupported)?;
        if token.is_empty() || token.len() > 4096 || token.chars().any(char::is_control) {
            return Err(StorageError::invalid_config());
        }
        let body = format!(
            r#"<?xml version="1.0" encoding="utf-8"?><d:sync-collection xmlns:d="DAV:"><d:sync-token>{}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/></d:prop></d:sync-collection>"#,
            xml_text(token)
        );
        let request = self
            .request(
                Method::from_bytes(b"REPORT").expect("valid method"),
                self.base_url.clone(),
            )
            .header(DAV_DEPTH, "1")
            .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
            .body(body);
        let response = self.send(request).await?;
        if response.status() != StatusCode::MULTI_STATUS {
            return Err(map_status(response.status()));
        }
        let header_token = response
            .headers()
            .get(DAV_SYNC_TOKEN)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let bytes = read_limited_body(response, MAX_XML_BYTES).await?;
        let next_token = parse_sync_token(&bytes)?
            .or(header_token)
            .or_else(|| Some(token.to_owned()));
        let responses = parse_multistatus(&bytes)?;
        let mut changes = Vec::with_capacity(responses.len());
        for response in responses {
            let path = self.href_to_path(&response.href)?;
            if path.is_root() {
                continue;
            }
            let kind = if response.status == Some(404) {
                ChangeKind::Delete
            } else {
                ChangeKind::Upsert
            };
            let entry = if matches!(kind, ChangeKind::Upsert) {
                Some(self.entry_from_response(response)?)
            } else {
                None
            };
            changes.push(RemoteChange { path, kind, entry });
        }
        // RFC 6578 returns the next token in the XML body.  Some servers also
        // return it as a header; the parser captures the standard body token.
        Ok(ChangePage {
            cursor: next_token,
            changes,
        })
    }
}

async fn read_limited_body(response: reqwest::Response, maximum: usize) -> StorageResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(StorageError::invalid_response());
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(maximum as u64) as usize,
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(map_reqwest_error)?;
        if chunk.len() > maximum.saturating_sub(body.len()) {
            return Err(StorageError::invalid_response());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn map_reqwest_error(error: reqwest::Error) -> StorageError {
    if error.is_timeout() {
        StorageError::new(StorageErrorCode::Timeout)
    } else if error.is_connect() || error.is_request() {
        StorageError::new(StorageErrorCode::Unavailable)
    } else {
        StorageError::new(StorageErrorCode::InvalidResponse)
    }
}

fn map_status(status: StatusCode) -> StorageError {
    match status.as_u16() {
        401 => StorageError::new(StorageErrorCode::Unauthorized),
        403 => StorageError::new(StorageErrorCode::Forbidden),
        404 => StorageError::new(StorageErrorCode::NotFound),
        409 | 412 => StorageError::new(StorageErrorCode::Conflict),
        405 | 501 => StorageError::unsupported(),
        408 | 504 => StorageError::new(StorageErrorCode::Timeout),
        429 | 500..=599 => StorageError::new(StorageErrorCode::Unavailable),
        _ => StorageError::new(StorageErrorCode::InvalidResponse),
    }
}

#[derive(Default, Debug)]
struct DavResponse {
    href: String,
    etag: Option<String>,
    size: Option<u64>,
    is_collection: bool,
    status: Option<u16>,
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn parse_multistatus(bytes: &[u8]) -> StorageResult<Vec<DavResponse>> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut responses = Vec::new();
    let mut current: Option<DavResponse> = None;
    let mut element: Option<Vec<u8>> = None;
    let mut in_resourcetype = false;

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| StorageError::invalid_response())?
        {
            Event::Eof => break,
            Event::DocType(_) => return Err(StorageError::invalid_response()),
            Event::Start(start) => {
                let name = local_name(start.name().as_ref()).to_vec();
                if name == b"response" {
                    current = Some(DavResponse::default());
                }
                if name == b"resourcetype" {
                    in_resourcetype = true;
                }
                if in_resourcetype && name == b"collection" {
                    if let Some(response) = &mut current {
                        response.is_collection = true;
                    }
                }
                element = Some(name);
            }
            Event::Empty(empty) => {
                let raw_name = empty.name().as_ref().to_vec();
                let name = local_name(&raw_name);
                if in_resourcetype && name == b"collection" {
                    if let Some(response) = &mut current {
                        response.is_collection = true;
                    }
                }
            }
            Event::Text(text) => {
                // XML text nodes carry escaped entities; CDATA below is
                // intentionally literal.  Decoding both through the same
                // raw-byte path would turn `&amp;` into the wrong href/ETag.
                let text = text
                    .unescape()
                    .map_err(|_| StorageError::invalid_response())?;
                assign_response_text(&mut current, element.as_deref(), &text);
            }
            Event::CData(text) => {
                let text = reader
                    .decoder()
                    .decode(text.as_ref())
                    .map_err(|_| StorageError::invalid_response())?;
                assign_response_text(&mut current, element.as_deref(), &text);
            }
            Event::End(end) => {
                let raw_name = end.name().as_ref().to_vec();
                let name = local_name(&raw_name);
                if name == b"resourcetype" {
                    in_resourcetype = false;
                }
                if name == b"response" {
                    let response = current.take().ok_or_else(StorageError::invalid_response)?;
                    if response.href.is_empty() {
                        return Err(StorageError::invalid_response());
                    }
                    responses.push(response);
                }
                element = None;
            }
            _ => {}
        }
        buffer.clear();
    }
    if current.is_some() || responses.len() > 100_000 {
        return Err(StorageError::invalid_response());
    }
    Ok(responses)
}

fn parse_status(value: &str) -> Option<u16> {
    value.split_whitespace().nth(1)?.parse().ok()
}

fn xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn assign_response_text(current: &mut Option<DavResponse>, element: Option<&[u8]>, text: &str) {
    let Some(response) = current else {
        return;
    };
    match element {
        Some(b"href") => response.href.push_str(text),
        Some(b"getetag") => response.etag = Some(text.to_owned()),
        Some(b"getcontentlength") => response.size = text.parse().ok(),
        Some(b"status") => response.status = parse_status(text),
        _ => {}
    }
}

fn parse_sync_token(bytes: &[u8]) -> StorageResult<Option<String>> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut is_token = false;
    let mut token = None;
    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|_| StorageError::invalid_response())?
        {
            Event::Eof => break,
            Event::DocType(_) => return Err(StorageError::invalid_response()),
            Event::Start(start) => {
                let raw_name = start.name().as_ref().to_vec();
                is_token = local_name(&raw_name) == b"sync-token";
            }
            Event::End(end) => {
                let raw_name = end.name().as_ref().to_vec();
                if local_name(&raw_name) == b"sync-token" {
                    is_token = false;
                }
            }
            Event::Text(text) if is_token => {
                let value = text
                    .unescape()
                    .map_err(|_| StorageError::invalid_response())?;
                if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
                    return Err(StorageError::invalid_response());
                }
                token = Some(value.into_owned());
            }
            Event::CData(text) if is_token => {
                let value = reader
                    .decoder()
                    .decode(text.as_ref())
                    .map_err(|_| StorageError::invalid_response())?;
                if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
                    return Err(StorageError::invalid_response());
                }
                token = Some(value.into_owned());
            }
            _ => {}
        }
        buffer.clear();
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn fake_dav_once(response: String) -> (String, tokio::task::JoinHandle<Vec<u8>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 2048];
            loop {
                let count = stream.read(&mut chunk).await.unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            stream.write_all(response.as_bytes()).await.unwrap();
            request
        });
        (format!("http://{address}/dav/"), task)
    }

    async fn fake_dav_many(
        responses: Vec<String>,
    ) -> (String, tokio::task::JoinHandle<Vec<Vec<u8>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut chunk = [0u8; 2048];
                let mut expected = None;
                loop {
                    let count = stream.read(&mut chunk).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..count]);
                    if expected.is_none() {
                        if let Some(headers_end) =
                            request.windows(4).position(|window| window == b"\r\n\r\n")
                        {
                            let headers = String::from_utf8_lossy(&request[..headers_end]);
                            let length = headers
                                .lines()
                                .find_map(|line| {
                                    line.split_once(':').filter(|(name, _)| {
                                        name.eq_ignore_ascii_case("content-length")
                                    })
                                })
                                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            expected = Some(headers_end + 4 + length);
                        }
                    }
                    if expected.is_some_and(|expected| request.len() >= expected) {
                        break;
                    }
                }
                stream.write_all(response.as_bytes()).await.unwrap();
                requests.push(request);
            }
            requests
        });
        (format!("http://{address}/dav/"), task)
    }

    #[test]
    fn config_rejects_embedded_or_insecure_remote_credentials() {
        for base_url in [
            "https://alice:secret@example.test/dav/",
            "http://example.test/dav/",
        ] {
            assert_eq!(
                WebDavConfig {
                    base_url: base_url.into()
                }
                .validate()
                .unwrap_err()
                .code,
                StorageErrorCode::InvalidConfig
            );
        }
        assert!(WebDavConfig {
            base_url: "http://127.0.0.1/dav".into()
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn path_url_encodes_each_dangerous_segment() {
        let provider = WebDavProvider::new(
            WebDavConfig {
                base_url: "https://dav.example.test/root/".into(),
            },
            WebDavCredentials {
                username: "alice".into(),
                password: "secret".into(),
            },
        )
        .unwrap();
        let url = provider
            .url_for(&RemotePath::new("a b/#?.md").unwrap())
            .unwrap();
        assert_eq!(
            url.as_str(),
            "https://dav.example.test/root/a%20b/%23%3F.md"
        );
    }

    #[test]
    fn multistatus_parser_rejects_doctype_and_reads_props() {
        assert_eq!(
            parse_multistatus(br#"<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///secret'>]><x/>"#)
                .unwrap_err()
                .code,
            StorageErrorCode::InvalidResponse
        );
        let parsed = parse_multistatus(br#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/root/a.md</d:href><d:propstat><d:prop><d:getetag>"x"</d:getetag><d:getcontentlength>9</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#).unwrap();
        assert_eq!(parsed[0].etag.as_deref(), Some("\"x\""));
        assert_eq!(parsed[0].size, Some(9));
    }

    #[test]
    fn multistatus_unescapes_text_but_keeps_cdata_literal() {
        let parsed = parse_multistatus(
            br#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/a&amp;b.md</d:href><d:propstat><d:prop><d:getetag>&quot;v&amp;1&quot;</d:getetag></d:prop><d:status><![CDATA[HTTP/1.1 200 OK &amp; literal]]></d:status></d:propstat></d:response><d:response><d:href><![CDATA[/dav/c&amp;d.md]]></d:href></d:response></d:multistatus>"#,
        )
        .unwrap();
        assert_eq!(parsed[0].href, "/dav/a&b.md");
        assert_eq!(parsed[0].etag.as_deref(), Some("\"v&1\""));
        assert_eq!(parsed[0].status, Some(200));
        assert_eq!(parsed[1].href, "/dav/c&amp;d.md");
    }

    #[tokio::test]
    async fn probe_never_claims_cas_when_only_a_weak_etag_is_observed() {
        let options = "HTTP/1.1 200 OK\r\nDAV: 1, 2\r\nAllow: OPTIONS, PUT\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:getetag>W/"root"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#;
        let propfind = format!(
            "HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            xml.len(),
            xml
        );
        let (base_url, server) = fake_dav_many(vec![options.into(), propfind]).await;
        let provider = WebDavProvider::new(
            WebDavConfig { base_url },
            WebDavCredentials {
                username: "alice".into(),
                password: "secret".into(),
            },
        )
        .unwrap();

        assert!(!provider.probe().await.unwrap().conditional_write);
        let requests = server.await.unwrap();
        assert!(String::from_utf8_lossy(&requests[1]).starts_with("PROPFIND /dav/ HTTP/1.1"));
    }

    #[tokio::test]
    async fn file_mutations_reject_weak_etags_before_sending_a_request() {
        let provider = WebDavProvider::new(
            WebDavConfig {
                base_url: "http://127.0.0.1:9/dav/".into(),
            },
            WebDavCredentials {
                username: "alice".into(),
                password: "secret".into(),
            },
        )
        .unwrap();
        assert_eq!(
            provider
                .write(ConditionalWrite {
                    path: RemotePath::new("note.md").unwrap(),
                    bytes: b"note".to_vec(),
                    precondition: WritePrecondition::Match(
                        RemoteVersion::new("W/\"v1\"").unwrap(),
                    ),
                })
                .await
                .unwrap_err()
                .code,
            StorageErrorCode::InvalidResponse
        );
    }

    #[test]
    fn status_errors_are_sanitized() {
        assert_eq!(
            map_status(StatusCode::PRECONDITION_FAILED).code,
            StorageErrorCode::Conflict
        );
        assert_eq!(
            map_status(StatusCode::INTERNAL_SERVER_ERROR).code,
            StorageErrorCode::Unavailable
        );
    }

    #[tokio::test]
    async fn list_uses_a_real_local_dav_server_with_depth_and_basic_auth() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/note.md</d:href><d:propstat><d:prop><d:getetag>"v1"</d:getetag><d:getcontentlength>4</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#;
        let response = format!("HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", xml.len(), xml);
        let (base_url, server) = fake_dav_once(response).await;
        let provider = WebDavProvider::new(
            WebDavConfig { base_url },
            WebDavCredentials {
                username: "alice".into(),
                password: "secret".into(),
            },
        )
        .unwrap();
        let entries = provider.list(&RemotePath::root()).await.unwrap();
        let request = String::from_utf8(server.await.unwrap()).unwrap();
        assert!(request.starts_with("PROPFIND /dav/ HTTP/1.1"));
        assert!(request.contains("depth: 1") || request.contains("Depth: 1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: basic ywxpy2u6c2vjcmv0"));
        assert_eq!(
            entries,
            vec![RemoteEntry {
                path: RemotePath::new("note.md").unwrap(),
                kind: RemoteEntryKind::File,
                version: Some(RemoteVersion::new("\"v1\"").unwrap()),
                remote_id: None,
                content_hash: None,
                size: Some(4),
            }]
        );
    }

    #[tokio::test]
    async fn local_dav_server_exercises_mutating_methods_and_etag_preconditions() {
        let response = |status: &str, headers: &str, body: &str| {
            format!(
            "HTTP/1.1 {status}\r\nConnection: close\r\n{headers}Content-Length: {}\r\n\r\n{body}", body.len()
        )
        };
        let responses = vec![
            response(
                "200 OK",
                "DAV: 1, 2\r\nAllow: OPTIONS, GET, PUT, MKCOL, MOVE, DELETE\r\n",
                "",
            ),
            response(
                "207 Multi-Status",
                "Content-Type: application/xml\r\n",
                r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:getetag>"root-v1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#,
            ),
            response("200 OK", "ETag: \"v1\"\r\n", "note"),
            response("204 No Content", "ETag: \"v2\"\r\n", ""),
            response("201 Created", "ETag: \"dir1\"\r\n", ""),
            response("201 Created", "ETag: \"v3\"\r\n", ""),
            response("204 No Content", "", ""),
        ];
        let (base_url, server) = fake_dav_many(responses).await;
        let provider = WebDavProvider::new(
            WebDavConfig { base_url },
            WebDavCredentials {
                username: "alice".into(),
                password: "secret".into(),
            },
        )
        .unwrap();
        assert!(provider.probe().await.unwrap().conditional_write);
        assert_eq!(
            provider
                .read(&RemotePath::new("note.md").unwrap())
                .await
                .unwrap()
                .bytes,
            b"note"
        );
        assert_eq!(
            provider
                .write(ConditionalWrite {
                    path: RemotePath::new("note.md").unwrap(),
                    bytes: b"changed".to_vec(),
                    precondition: WritePrecondition::Match(RemoteVersion::new("\"v1\"").unwrap()),
                })
                .await
                .unwrap()
                .opaque,
            "\"v2\""
        );
        provider
            .create_dir(&RemotePath::new("folder").unwrap())
            .await
            .unwrap();
        provider
            .move_entry(ConditionalMove {
                from: RemotePath::new("note.md").unwrap(),
                to: RemotePath::new("moved.md").unwrap(),
                overwrite: false,
                expected_source: Some(RemoteVersion::new("\"v2\"").unwrap()),
            })
            .await
            .unwrap();
        provider
            .delete(ConditionalDelete {
                path: RemotePath::new("moved.md").unwrap(),
                expected: Some(RemoteVersion::new("\"v3\"").unwrap()),
            })
            .await
            .unwrap();
        let requests = server
            .await
            .unwrap()
            .into_iter()
            .map(|request| String::from_utf8(request).unwrap())
            .collect::<Vec<_>>();
        assert!(requests[0].starts_with("OPTIONS /dav/ HTTP/1.1"));
        assert!(requests[1].starts_with("PROPFIND /dav/ HTTP/1.1"));
        assert!(
            requests[2].starts_with("GET /dav/note.md HTTP/1.1"),
            "requests: {requests:#?}"
        );
        assert!(requests[3].starts_with("PUT /dav/note.md HTTP/1.1"));
        assert!(
            requests[3].contains("if-match: \"v1\"") || requests[3].contains("If-Match: \"v1\"")
        );
        assert!(requests[4].starts_with("MKCOL /dav/folder HTTP/1.1"));
        assert!(requests[5].starts_with("MOVE /dav/note.md HTTP/1.1"));
        assert!(
            requests[5].contains("destination: http://")
                || requests[5].contains("Destination: http://")
        );
        assert!(requests[6].starts_with("DELETE /dav/moved.md HTTP/1.1"));
    }
}
