//! Charset detection and loss-aware Unicode conversion.
//!
//! `encoding_rs` covers the WHATWG encodings used by the settings schema.
//! UTF-16/32 and strict ASCII are handled explicitly because they are outside
//! (or intentionally differ from) the WHATWG label behavior.

use encoding_rs::{Encoding, UTF_8};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bom {
    Utf8,
    Utf16Le,
    Utf16Be,
    Utf32Le,
    Utf32Be,
}

impl Bom {
    pub const fn bytes(self) -> &'static [u8] {
        match self {
            Self::Utf8 => &[0xEF, 0xBB, 0xBF],
            Self::Utf16Le => &[0xFF, 0xFE],
            Self::Utf16Be => &[0xFE, 0xFF],
            Self::Utf32Le => &[0xFF, 0xFE, 0x00, 0x00],
            Self::Utf32Be => &[0x00, 0x00, 0xFE, 0xFF],
        }
    }

    pub const fn encoding_name(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf16Le => "UTF-16LE",
            Self::Utf16Be => "UTF-16BE",
            Self::Utf32Le => "UTF-32LE",
            Self::Utf32Be => "UTF-32BE",
        }
    }
}

/// Detect a Unicode byte-order mark. UTF-32 signatures must be checked before
/// UTF-16LE because they share the `FF FE` prefix.
pub fn detect_bom(bytes: &[u8]) -> Option<Bom> {
    if bytes.starts_with(Bom::Utf32Be.bytes()) {
        Some(Bom::Utf32Be)
    } else if bytes.starts_with(Bom::Utf32Le.bytes()) {
        Some(Bom::Utf32Le)
    } else if bytes.starts_with(Bom::Utf8.bytes()) {
        Some(Bom::Utf8)
    } else if bytes.starts_with(Bom::Utf16Be.bytes()) {
        Some(Bom::Utf16Be)
    } else if bytes.starts_with(Bom::Utf16Le.bytes()) {
        Some(Bom::Utf16Le)
    } else {
        None
    }
}

/// Return the BOM corresponding to a Unicode encoding label. Legacy encodings
/// intentionally return `None` because prefixing them with a Unicode BOM would
/// corrupt their byte stream.
pub fn bom_for_label(label: &str) -> Option<Bom> {
    match compact_label(label).as_str() {
        "utf8" => Some(Bom::Utf8),
        "utf16le" => Some(Bom::Utf16Le),
        "utf16be" => Some(Bom::Utf16Be),
        "utf32le" => Some(Bom::Utf32Le),
        "utf32be" => Some(Bom::Utf32Be),
        _ => None,
    }
}

/// Detect the charset of a byte slice and decode it as UTF-8.
///
/// Returns `(decoded_text, encoding_name, had_replacement_chars)`.
pub fn detect_and_decode(bytes: &[u8]) -> AppResult<(String, &'static str, bool)> {
    if let Some(bom) = detect_bom(bytes) {
        let payload = &bytes[bom.bytes().len()..];
        return match bom {
            Bom::Utf8 => decode_with_encoding(payload, UTF_8),
            Bom::Utf16Le => decode_utf16(payload, false),
            Bom::Utf16Be => decode_utf16(payload, true),
            Bom::Utf32Le => decode_utf32(payload, false),
            Bom::Utf32Be => decode_utf32(payload, true),
        };
    }

    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding: &'static Encoding = detector.guess(None, true);
    decode_with_encoding(bytes, encoding)
}

/// Decode using an explicitly selected encoding instead of charset detection.
pub fn decode(bytes: &[u8], source: &str) -> AppResult<(String, &'static str, bool)> {
    match compact_label(source).as_str() {
        "ascii" => return Ok(decode_ascii(bytes)),
        "utf8" => {
            return decode_with_encoding(strip_prefix(bytes, Bom::Utf8.bytes()), UTF_8);
        }
        "utf16le" => return decode_utf16(strip_prefix(bytes, Bom::Utf16Le.bytes()), false),
        "utf16be" => return decode_utf16(strip_prefix(bytes, Bom::Utf16Be.bytes()), true),
        "utf32le" => return decode_utf32(strip_prefix(bytes, Bom::Utf32Le.bytes()), false),
        "utf32be" => return decode_utf32(strip_prefix(bytes, Bom::Utf32Be.bytes()), true),
        _ => {}
    }
    let encoding = encoding_for_label(source)
        .ok_or_else(|| AppError::InvalidArgument(format!("unknown encoding: {source}")))?;
    decode_with_encoding(bytes, encoding)
}

/// Encode a UTF-8 string back into a target charset for save. This function
/// never inserts a BOM; callers choose that policy explicitly via [`Bom`].
pub fn encode(text: &str, target: &str) -> AppResult<Vec<u8>> {
    match compact_label(target).as_str() {
        "ascii" => return encode_ascii(text),
        "utf16le" => {
            return Ok(text
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>());
        }
        "utf16be" => {
            return Ok(text
                .encode_utf16()
                .flat_map(u16::to_be_bytes)
                .collect::<Vec<_>>());
        }
        "utf32le" => {
            return Ok(text
                .chars()
                .flat_map(|character| (character as u32).to_le_bytes())
                .collect::<Vec<_>>());
        }
        "utf32be" => {
            return Ok(text
                .chars()
                .flat_map(|character| (character as u32).to_be_bytes())
                .collect::<Vec<_>>());
        }
        _ => {}
    }
    let encoding = encoding_for_label(target)
        .ok_or_else(|| AppError::InvalidArgument(format!("unknown encoding: {target}")))?;
    let (bytes, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(AppError::InvalidArgument(format!(
            "the document contains characters that cannot be represented as {target}"
        )));
    }
    Ok(bytes.into_owned())
}

fn decode_with_encoding(
    bytes: &[u8],
    encoding: &'static Encoding,
) -> AppResult<(String, &'static str, bool)> {
    let (text, had_errors) = encoding.decode_without_bom_handling(bytes);
    Ok((text.into_owned(), encoding.name(), had_errors))
}

fn decode_ascii(bytes: &[u8]) -> (String, &'static str, bool) {
    let mut had_errors = false;
    let text = bytes
        .iter()
        .map(|byte| {
            if byte.is_ascii() {
                char::from(*byte)
            } else {
                had_errors = true;
                char::REPLACEMENT_CHARACTER
            }
        })
        .collect();
    (text, "US-ASCII", had_errors)
}

fn encode_ascii(text: &str) -> AppResult<Vec<u8>> {
    if text.is_ascii() {
        Ok(text.as_bytes().to_vec())
    } else {
        Err(AppError::InvalidArgument(
            "the document contains characters that cannot be represented as ascii".into(),
        ))
    }
}

fn compact_label(label: &str) -> String {
    label
        .chars()
        .filter(|character| !matches!(character, '-' | '_' | ' '))
        .flat_map(char::to_lowercase)
        .collect()
}

fn encoding_for_label(label: &str) -> Option<&'static Encoding> {
    let compact = compact_label(label);
    let canonical = match compact.as_str() {
        "utf8" => "utf-8",
        "latin3" => "iso-8859-3",
        "iso885915" => "iso-8859-15",
        "cp1252" => "windows-1252",
        "cp1256" => "windows-1256",
        "latin4" => "iso-8859-4",
        "cp1257" => "windows-1257",
        "iso88592" => "iso-8859-2",
        "windows1250" => "windows-1250",
        "cp866" => "ibm866",
        "iso88595" => "iso-8859-5",
        "koi8r" => "koi8-r",
        "koi8u" => "koi8-u",
        "cp1251" => "windows-1251",
        "iso885913" => "iso-8859-13",
        "cp1253" => "windows-1253",
        "cp1255" => "windows-1255",
        "latin5" | "cp1254" => "windows-1254",
        "gb2312" | "gbk" => "gbk",
        "gb18030" => "gb18030",
        "big5" | "big5hkscs" => "big5",
        "shiftjis" => "shift_jis",
        "eucjp" => "euc-jp",
        "euckr" => "euc-kr",
        "latin6" => "iso-8859-10",
        _ => label,
    };
    Encoding::for_label(canonical.as_bytes())
}

fn strip_prefix<'a>(bytes: &'a [u8], prefix: &[u8]) -> &'a [u8] {
    bytes.strip_prefix(prefix).unwrap_or(bytes)
}

fn decode_utf16(bytes: &[u8], big_endian: bool) -> AppResult<(String, &'static str, bool)> {
    let mut had_errors = false;
    let mut chunks = bytes.chunks_exact(2);
    let units = chunks.by_ref().map(|chunk| {
        let pair = [chunk[0], chunk[1]];
        if big_endian {
            u16::from_be_bytes(pair)
        } else {
            u16::from_le_bytes(pair)
        }
    });
    let mut text: String = char::decode_utf16(units)
        .map(|result| match result {
            Ok(character) => character,
            Err(_) => {
                had_errors = true;
                char::REPLACEMENT_CHARACTER
            }
        })
        .collect();
    if !chunks.remainder().is_empty() {
        had_errors = true;
        text.push(char::REPLACEMENT_CHARACTER);
    }
    Ok((
        text,
        if big_endian { "UTF-16BE" } else { "UTF-16LE" },
        had_errors,
    ))
}

fn decode_utf32(bytes: &[u8], big_endian: bool) -> AppResult<(String, &'static str, bool)> {
    let mut had_errors = false;
    let mut chunks = bytes.chunks_exact(4);
    let mut text: String = chunks
        .by_ref()
        .map(|chunk| {
            let word = [chunk[0], chunk[1], chunk[2], chunk[3]];
            let scalar = if big_endian {
                u32::from_be_bytes(word)
            } else {
                u32::from_le_bytes(word)
            };
            char::from_u32(scalar).unwrap_or_else(|| {
                had_errors = true;
                char::REPLACEMENT_CHARACTER
            })
        })
        .collect();
    if !chunks.remainder().is_empty() {
        had_errors = true;
        text.push(char::REPLACEMENT_CHARACTER);
    }
    Ok((
        text,
        if big_endian { "UTF-32BE" } else { "UTF-32LE" },
        had_errors,
    ))
}

/// Detect the line-ending style used by a piece of text.
pub fn detect_line_ending(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count().saturating_sub(crlf);
    if crlf > lf {
        "crlf"
    } else {
        "lf"
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    const EXPECTED_SCHEMA_ENCODINGS: &[(&str, &str)] = &[
        ("ascii", "US-ASCII"),
        ("utf8", "UTF-8"),
        ("utf16be", "UTF-16BE"),
        ("utf16le", "UTF-16LE"),
        ("utf32be", "UTF-32BE"),
        ("utf32le", "UTF-32LE"),
        ("latin3", "ISO-8859-3"),
        ("iso885915", "ISO-8859-15"),
        ("cp1252", "windows-1252"),
        ("arabic", "ISO-8859-6"),
        ("cp1256", "windows-1256"),
        ("latin4", "ISO-8859-4"),
        ("cp1257", "windows-1257"),
        ("iso88592", "ISO-8859-2"),
        ("windows1250", "windows-1250"),
        ("cp866", "IBM866"),
        ("iso88595", "ISO-8859-5"),
        ("koi8r", "KOI8-R"),
        ("koi8u", "KOI8-U"),
        ("cp1251", "windows-1251"),
        ("iso885913", "ISO-8859-13"),
        ("greek", "ISO-8859-7"),
        ("cp1253", "windows-1253"),
        ("hebrew", "ISO-8859-8"),
        ("cp1255", "windows-1255"),
        ("latin5", "windows-1254"),
        ("cp1254", "windows-1254"),
        ("gb2312", "GBK"),
        ("gb18030", "gb18030"),
        ("gbk", "GBK"),
        ("big5", "Big5"),
        ("big5hkscs", "Big5"),
        ("shiftjis", "Shift_JIS"),
        ("eucjp", "EUC-JP"),
        ("euckr", "EUC-KR"),
        ("latin6", "ISO-8859-10"),
    ];

    fn schema_encoding_labels() -> Vec<String> {
        let schema: Value =
            serde_json::from_str(include_str!("../../../src/common/preferences-schema.json"))
                .unwrap();
        schema["defaultEncoding"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn every_schema_encoding_alias_round_trips_ascii() {
        for label in schema_encoding_labels() {
            let bytes = encode("plain ASCII", &label)
                .unwrap_or_else(|error| panic!("schema encoding {label} cannot encode: {error}"));
            let (text, _, had_errors) = decode(&bytes, &label)
                .unwrap_or_else(|error| panic!("schema encoding {label} cannot decode: {error}"));
            assert_eq!(text, "plain ASCII", "schema encoding {label}");
            assert!(!had_errors, "schema encoding {label}");
        }
    }

    #[test]
    fn every_schema_alias_resolves_to_the_expected_encoding() {
        let labels = schema_encoding_labels();
        let expected_labels: Vec<_> = EXPECTED_SCHEMA_ENCODINGS
            .iter()
            .map(|(label, _)| (*label).to_owned())
            .collect();
        assert_eq!(
            labels, expected_labels,
            "encoding schema and backend drifted"
        );

        for (label, expected_name) in EXPECTED_SCHEMA_ENCODINGS {
            let (_, actual_name, _) = decode(&[], label).unwrap();
            assert_eq!(actual_name, *expected_name, "schema encoding {label}");
        }
    }

    #[test]
    fn strict_ascii_never_silently_accepts_high_bytes_or_unicode() {
        let (text, encoding, had_errors) = decode(&[b'A', 0xE9], "ascii").unwrap();
        assert_eq!(text, "A�");
        assert_eq!(encoding, "US-ASCII");
        assert!(had_errors);
        assert!(encode("é", "ascii").is_err());
    }

    #[test]
    fn unicode_boms_are_detected_stripped_and_report_the_right_encoding() {
        for bom in [
            Bom::Utf8,
            Bom::Utf16Le,
            Bom::Utf16Be,
            Bom::Utf32Le,
            Bom::Utf32Be,
        ] {
            let mut bytes = bom.bytes().to_vec();
            bytes.extend(encode("A😀", bom.encoding_name()).unwrap());

            assert_eq!(detect_bom(&bytes), Some(bom));
            assert_eq!(bom_for_label(bom.encoding_name()), Some(bom));

            let (detected_text, detected_encoding, detected_errors) =
                detect_and_decode(&bytes).unwrap();
            assert_eq!(detected_text, "A😀", "{bom:?}");
            assert_eq!(detected_encoding, bom.encoding_name(), "{bom:?}");
            assert!(!detected_errors, "{bom:?}");

            let (explicit_text, explicit_encoding, explicit_errors) =
                decode(&bytes, bom.encoding_name()).unwrap();
            assert_eq!(explicit_text, "A😀", "{bom:?}");
            assert_eq!(explicit_encoding, bom.encoding_name(), "{bom:?}");
            assert!(!explicit_errors, "{bom:?}");
        }
    }

    #[test]
    fn utf32_le_bom_is_not_misclassified_as_utf16_le() {
        assert_eq!(
            detect_bom(&[0xFF, 0xFE, 0x00, 0x00, b'A', 0, 0, 0]),
            Some(Bom::Utf32Le)
        );
    }

    #[test]
    fn incomplete_utf16_and_utf32_units_are_visible_decode_errors() {
        let (utf16, _, utf16_errors) = decode(&[b'A', 0, b'B'], "utf16le").unwrap();
        assert_eq!(utf16, "A�");
        assert!(utf16_errors);

        let (utf32, _, utf32_errors) = decode(&[b'A', 0, 0, 0, b'B'], "utf32le").unwrap();
        assert_eq!(utf32, "A�");
        assert!(utf32_errors);
    }

    #[test]
    fn explicit_encoding_decode_skips_detection() {
        let (text, encoding, had_errors) = decode(&[0xe9], "windows-1252").unwrap();
        assert_eq!(text, "é");
        assert_eq!(encoding, "windows-1252");
        assert!(!had_errors);
    }

    #[test]
    fn explicit_encoding_rejects_unknown_label() {
        assert!(decode(b"text", "definitely-not-an-encoding").is_err());
    }

    #[test]
    fn encoding_never_silently_replaces_unrepresentable_characters() {
        assert!(encode("中文", "windows-1252").is_err());
    }
}
