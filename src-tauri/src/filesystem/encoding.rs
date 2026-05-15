//! Charset detection & UTF-8 conversion.
//!
//! Replaces the `ced` native addon. Uses `chardetng` for detection (the same
//! algorithm Firefox ships) and `encoding_rs` for conversion.

use encoding_rs::Encoding;

use crate::error::AppResult;

/// Detect the charset of a byte slice and decode it as UTF-8.
///
/// Returns `(decoded_text, encoding_name, had_replacement_chars)`.
pub fn detect_and_decode(bytes: &[u8]) -> AppResult<(String, &'static str, bool)> {
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding: &'static Encoding = detector.guess(None, true);
    let (text, _, had_errors) = encoding.decode(bytes);
    Ok((text.into_owned(), encoding.name(), had_errors))
}

/// Encode a UTF-8 string back into a target charset for save.
pub fn encode(text: &str, target: &str) -> AppResult<Vec<u8>> {
    let encoding = Encoding::for_label(target.as_bytes()).ok_or_else(|| {
        crate::error::AppError::InvalidArgument(format!("unknown encoding: {target}"))
    })?;
    let (bytes, _, _) = encoding.encode(text);
    Ok(bytes.into_owned())
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
