use super::{failure, AppResult, Message};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_IMAGE: usize = 5 * 1024 * 1024;
const MAX_TOTAL: usize = 20 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Image {
    name: String,
    data_url: String,
}

/// Validate independently of the renderer. Only inline raster data is accepted;
/// URLs, file paths, SVG and arbitrary content parts never reach the provider.
pub(super) fn validate(messages: &[Message]) -> AppResult<()> {
    let mut count = 0;
    let mut total = 0;
    for message in messages {
        if message.images.len() > 4 {
            return Err(failure("imageCount"));
        }
        if message.role != "user" && !message.images.is_empty() {
            return Err(failure("invalidRequest"));
        }
        count += message.images.len();
        if count > 12 {
            return Err(failure("imageHistoryLimit"));
        }
        for image in &message.images {
            if image.name.len() > 1024 {
                return Err(failure("invalidRequest"));
            }
            let (header, encoded) = image
                .data_url
                .split_once(',')
                .ok_or_else(|| failure("imageType"))?;
            if !matches!(
                header,
                "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
            ) {
                return Err(failure("imageType"));
            }
            if encoded.len() > MAX_IMAGE.div_ceil(3) * 4 {
                return Err(failure("imageSize"));
            }
            let bytes = STANDARD.decode(encoded).map_err(|_| failure("imageRead"))?;
            if bytes.is_empty() || bytes.len() > MAX_IMAGE {
                return Err(failure("imageSize"));
            }
            let valid = match header {
                "data:image/png;base64" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "data:image/jpeg;base64" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
                "data:image/webp;base64" => {
                    bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
                }
                _ => false,
            };
            if !valid {
                return Err(failure("imageRead"));
            }
            total += bytes.len();
            if total > MAX_TOTAL {
                return Err(failure("imageHistoryLimit"));
            }
        }
    }
    Ok(())
}

pub(super) fn encoded_size(messages: &[Message]) -> usize {
    messages
        .iter()
        .flat_map(|m| &m.images)
        .map(|i| i.data_url.len())
        .sum()
}

pub(super) fn message(message: &Message) -> Value {
    if message.images.is_empty() {
        return json!({"role": message.role, "content": message.content});
    }
    let mut content = Vec::new();
    if !message.content.is_empty() {
        content.push(json!({"type": "text", "text": message.content}));
    }
    content.extend(message.images.iter().map(|image| {
        json!({
            "type": "image_url", "image_url": {"url": image.data_url}
        })
    }));
    json!({"role": message.role, "content": content})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message_with(url: String) -> Message {
        Message {
            role: "user".into(),
            content: String::new(),
            images: vec![Image {
                name: "paste.png".into(),
                data_url: url,
            }],
        }
    }
    fn png(size: usize) -> String {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.resize(size, 0);
        format!("data:image/png;base64,{}", STANDARD.encode(bytes))
    }

    #[test]
    fn accepts_inline_images_and_rejects_urls_formats_mismatches_and_assistant_images() {
        assert!(validate(&[message_with(png(8))]).is_ok());
        for url in [
            "https://example.com/image.png",
            "file:///private.png",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/png;base64,aGVsbG8=",
            "data:image/png;base64,!!",
        ] {
            assert!(validate(&[message_with(url.into())]).is_err());
        }
        let mut assistant = message_with(png(8));
        assistant.role = "assistant".into();
        assert!(validate(&[assistant]).is_err());
    }

    #[test]
    fn enforces_individual_count_and_aggregate_limits() {
        assert_eq!(
            validate(&[message_with(png(MAX_IMAGE + 1))])
                .unwrap_err()
                .to_string(),
            "agent:imageSize"
        );
        let mut many = message_with(png(8));
        many.images = vec![many.images[0].clone(); 5];
        assert_eq!(
            validate(&[many]).unwrap_err().to_string(),
            "agent:imageCount"
        );
        assert_eq!(
            validate(&vec![message_with(png(8)); 13])
                .unwrap_err()
                .to_string(),
            "agent:imageHistoryLimit"
        );
        assert_eq!(
            validate(&vec![message_with(png(MAX_IMAGE)); 5])
                .unwrap_err()
                .to_string(),
            "agent:imageHistoryLimit"
        );
    }

    #[test]
    fn preserves_text_protocol_and_supports_image_only_messages() {
        let image_only = message_with(png(8));
        assert_eq!(message(&image_only)["content"][0]["type"], "image_url");
        let mut mixed = image_only;
        mixed.content = "Explain".into();
        assert_eq!(
            message(&mixed)["content"][0],
            json!({"type":"text", "text":"Explain"})
        );
        mixed.images.clear();
        assert_eq!(message(&mixed)["content"], "Explain");
    }
}
