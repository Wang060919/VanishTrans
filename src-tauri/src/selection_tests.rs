//! Decision tests for the replace-target identity model.

use crate::keyboard::{ForegroundWindowToken, TextRangeIdentity};
use crate::selection::*;

fn window(value: isize) -> ForegroundWindowToken {
    ForegroundWindowToken::from_raw(value)
}

fn uia_target(control_id: Vec<i32>, text: &str, range: u64) -> SelectionTarget {
    SelectionTarget {
        window: window(1),
        focus_hwnd: Some(10),
        fingerprint: SelectionFingerprint::Uia {
            control_id,
            text: text.to_string(),
            range: TextRangeIdentity::fake(range),
        },
    }
}

fn edit_target(
    control_text: &str,
    start: u32,
    end: u32,
    caret: Option<[i32; 4]>,
) -> SelectionTarget {
    let utf16: Vec<u16> = control_text.encode_utf16().collect();
    SelectionTarget {
        window: window(1),
        focus_hwnd: Some(10),
        fingerprint: edit_fingerprint(&utf16, start, end, caret).expect("span must be readable"),
    }
}

fn valid(captured: &SelectionTarget, now: &SelectionTarget) -> bool {
    target_still_valid(captured, now)
}

#[test]
fn unchanged_snapshot_is_still_the_same_target() {
    let captured = uia_target(vec![7, 1], "hello", 1);
    let now = captured.clone();
    assert!(valid(&captured, &now));
}

#[test]
fn identical_text_in_another_input_control_is_a_different_target() {
    let captured = uia_target(vec![7, 1], "hello", 1);
    let now = uia_target(vec![7, 2], "hello", 1);
    assert!(!valid(&captured, &now));
}

#[test]
fn identical_text_at_another_logical_range_is_a_different_target() {
    // Same control, same text, same screen position: only the logical text
    // range differs, and that alone must invalidate the target.
    let captured = uia_target(vec![7, 1], "hello", 1);
    let now = uia_target(vec![7, 1], "hello", 2);
    assert!(!valid(&captured, &now));
}

#[test]
fn rewritten_content_at_the_same_range_is_a_different_target() {
    // Range equality does not prove content equality; the selected text must
    // be checked alongside the range.
    let captured = uia_target(vec![7, 1], "hello", 1);
    let now = uia_target(vec![7, 1], "howdy", 1);
    assert!(!valid(&captured, &now));
}

#[test]
fn switched_window_is_a_different_target() {
    let captured = uia_target(vec![7, 1], "hello", 1);
    let mut now = captured.clone();
    now.window = window(2);
    assert!(!valid(&captured, &now));
}

#[test]
fn edit_identity_changes_when_the_selected_content_changes() {
    // Same offsets and caret, but the text inside them was replaced: the
    // identity reads the span from the control, so the change is caught.
    let captured = edit_target("hello world", 0, 5, None);
    let now = edit_target("howdy world", 0, 5, None);
    assert_eq!(captured.source_text(), "hello");
    assert_eq!(now.source_text(), "howdy");
    assert!(!valid(&captured, &now));
}

#[test]
fn edit_identity_keeps_the_span_paired_with_its_position() {
    let captured = edit_target("hello hello", 0, 5, None);
    assert!(valid(&captured, &captured.clone()));
    // The same word selected elsewhere in the control is a different target.
    let now = edit_target("hello hello", 6, 11, None);
    assert!(!valid(&captured, &now));
}

#[test]
fn edit_identity_treats_the_caret_as_an_auxiliary_position_signal() {
    let captured = edit_target("hello", 0, 5, Some([8, 8, 9, 20]));
    let now = edit_target("hello", 0, 5, Some([900, 8, 901, 20]));
    assert!(!valid(&captured, &now));
}

#[test]
fn edit_fingerprint_rejects_selections_it_cannot_prove() {
    let utf16: Vec<u16> = "hello".encode_utf16().collect();
    // Empty selection.
    assert!(edit_fingerprint(&utf16, 3, 3, None).is_none());
    // Out of range (e.g. `EM_GETSEL` 16-bit truncation artifacts).
    assert!(edit_fingerprint(&utf16, 3, 99, None).is_none());
    // Whitespace-only spans are not translatable sources.
    let blanks: Vec<u16> = "a   b".encode_utf16().collect();
    assert!(edit_fingerprint(&blanks, 1, 4, None).is_none());
}

#[test]
fn multiline_spans_compare_after_line_ending_normalization() {
    let captured = edit_target("a\r\nb", 0, 4, None);
    assert_eq!(captured.source_text(), "a\nb");
    let now = edit_target("a\nb", 0, 3, None);
    // Offsets differ between representations, but the proven content is the
    // same and the comparison still refuses: the position is not the same.
    assert!(!valid(&captured, &now));
}
