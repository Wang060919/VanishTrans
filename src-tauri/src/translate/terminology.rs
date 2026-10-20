//! Match the existing case-sensitive glossary without changing its stored format.
use super::protection::protected_spans;

pub(super) fn matching_terms<'a>(
    text: &str,
    glossary: &'a [(String, String)],
) -> Vec<&'a (String, String)> {
    let protected = protected_spans(text);
    let mut candidates = Vec::new();
    for (index, (source, target)) in glossary.iter().enumerate() {
        if source.trim().is_empty() || target.trim().is_empty() {
            continue;
        }
        for (start, _) in text.match_indices(source) {
            let end = start + source.len();
            if protected
                .iter()
                .any(|span| start < span.end && end > span.start)
            {
                continue;
            }
            let first = source.chars().next().unwrap();
            let last = source.chars().next_back().unwrap();
            if word_char(first) && text[..start].chars().next_back().is_some_and(word_char) {
                continue;
            }
            if word_char(last) && text[end..].chars().next().is_some_and(word_char) {
                continue;
            }
            candidates.push((start, end, index));
        }
    }
    // Longest match wins at overlapping locations; original glossary order breaks ties.
    candidates.sort_by_key(|&(start, end, index)| (std::cmp::Reverse(end - start), index, start));
    let mut accepted = Vec::new();
    let mut indices = Vec::new();
    for (start, end, index) in candidates {
        if accepted.iter().any(|&(a, b)| start < b && end > a) {
            continue;
        }
        accepted.push((start, end));
        if !indices.contains(&index) {
            indices.push(index);
        }
    }
    indices.into_iter().map(|index| &glossary[index]).collect()
}

fn word_char(c: char) -> bool {
    c == '_' || (c.is_alphanumeric() && !is_cjk(c))
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3400..=0x9fff | 0x20000..=0x323af)
}
