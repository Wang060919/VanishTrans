//! Conservative literal spans: no masking, normalization or extra model call.
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProtectedSpan {
    pub start: usize,
    pub end: usize,
}

pub(super) fn protected_spans(text: &str) -> Vec<ProtectedSpan> {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        Regex::new(concat!(
            r"https?://[^\s<>\x22`。，；：！？、（）【】《》「」『』“”‘’]+|",
            r"\$\{[A-Za-z_][A-Za-z0-9_.]*\}|",
            r"\{\{[A-Za-z_][A-Za-z0-9_.]*\}\}|",
            r"\{[A-Za-z_][A-Za-z0-9_.]*\}|",
            r"%(?:[0-9]+\$)?[-+#0]*[0-9]*(?:\.[0-9]+)?[sdif]|",
            r#"</?[A-Za-z][A-Za-z0-9:_-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*?)?\s*/?>"#
        ))
        .expect("static protected span pattern")
    });
    let mut spans = code_spans(text);
    for hit in pattern.find_iter(text) {
        if spans
            .iter()
            .any(|span| hit.start() < span.end && hit.end() > span.start)
        {
            continue;
        }
        let literal = hit.as_str();
        // Do not treat prose percentages or escaped printf sequences as placeholders.
        if literal.starts_with('%')
            && (text[..hit.start()].ends_with('%')
                || text[hit.end()..]
                    .chars()
                    .next()
                    .is_some_and(char::is_alphanumeric))
        {
            continue;
        }
        // Reject partial matches inside malformed or more deeply nested braces.
        if literal.contains('{')
            && (text[..hit.start()].ends_with('{') || text[hit.end()..].starts_with('}'))
        {
            continue;
        }
        let mut end = hit.end();
        if literal.starts_with("http") {
            end = text[..end]
                .trim_end_matches(['.', ',', ';', ':', '!', '?', '。', '，'])
                .len();
            while text[hit.start()..end].ends_with(')')
                && text[hit.start()..end].matches(')').count()
                    > text[hit.start()..end].matches('(').count()
            {
                end -= 1;
            }
        }
        spans.push(ProtectedSpan {
            start: hit.start(),
            end,
        });
    }
    spans.sort_by_key(|span| span.start);
    spans
}

fn code_spans(text: &str) -> Vec<ProtectedSpan> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' && bytes[i] != b'~' {
            i += 1;
            continue;
        }
        let start = i;
        let marker = bytes[i];
        while i < bytes.len() && bytes[i] == marker {
            i += 1;
        }
        let width = i - start;
        let line_start = text[..start].rfind('\n').map_or(0, |pos| pos + 1);
        let indent = &text[line_start..start];
        if width >= 3 && indent.len() <= 3 && indent.bytes().all(|b| b == b' ') {
            let end = fence_end(text, i, marker, width);
            spans.push(ProtectedSpan { start, end });
            i = end;
            continue;
        }
        if marker == b'~' {
            continue;
        }
        let mut cursor = i;
        while cursor < bytes.len() {
            if bytes[cursor] != marker {
                cursor += 1;
                continue;
            }
            let close = cursor;
            while cursor < bytes.len() && bytes[cursor] == marker {
                cursor += 1;
            }
            if cursor - close == width {
                spans.push(ProtectedSpan { start, end: cursor });
                i = cursor;
                break;
            }
        }
    }
    spans
}

fn fence_end(text: &str, opening_end: usize, marker: u8, width: usize) -> usize {
    let Some(newline) = text[opening_end..].find('\n') else {
        return text.len();
    };
    let mut offset = opening_end + newline + 1;
    for line in text[offset..].split_inclusive('\n') {
        let content = line.trim_end_matches(['\r', '\n']);
        let trimmed = content.trim_start_matches(' ');
        let indent = content.len() - trimmed.len();
        let count = trimmed.bytes().take_while(|b| *b == marker).count();
        if indent <= 3 && count >= width && trimmed[count..].trim().is_empty() {
            return offset + content.len();
        }
        offset += line.len();
    }
    // An unclosed Markdown fence extends to EOF, rather than exposing code to translation.
    text.len()
}

/// Checks literal multiplicity, not semantic accuracy. Never includes source data in errors.
pub(super) fn validate_protected(source: &str, translated: &str) -> Result<(), String> {
    let literals = |text: &str| {
        let mut counts = std::collections::BTreeMap::new();
        for span in protected_spans(text) {
            *counts
                .entry(text[span.start..span.end].to_owned())
                .or_insert(0usize) += 1;
        }
        counts
    };
    let expected = literals(source);
    let actual = literals(translated);
    let tags = |text: &str| {
        protected_spans(text)
            .into_iter()
            .map(|span| text[span.start..span.end].to_owned())
            .filter(|literal| literal.starts_with('<'))
            .collect::<Vec<_>>()
    };
    let source_tags = tags(source);
    if expected
        .iter()
        .any(|(literal, count)| actual.get(literal).unwrap_or(&0) < count)
        || (!source_tags.is_empty() && source_tags != tags(translated))
    {
        return Err("译文遗漏或修改了代码、链接、变量或结构标记，请检查原文后重试".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "protection_tests.rs"]
mod tests;
