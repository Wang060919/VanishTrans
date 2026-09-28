//! Identity of the selection Alt+R replaces.
//!
//! Auto-replacement may only touch the selection the translation was captured
//! from. `SelectionTarget` snapshots the top-level window, the focused control
//! and a read-only fingerprint of the selection, so a changed target can be
//! proved before Ctrl+V instead of pasting wherever the caret happens to be.

use crate::keyboard::{ForegroundWindowToken, TextRangeIdentity};

/// Everything Ctrl+V would overwrite, snapshotted while the source text is
/// captured.
#[derive(Clone, Debug)]
pub struct SelectionTarget {
    pub window: ForegroundWindowToken,
    pub focus_hwnd: Option<isize>,
    pub fingerprint: SelectionFingerprint,
}

/// Read-only proof of where the selection sits inside its control and of what
/// it contains. Neither half is sufficient alone: the same text can be
/// selected at another place, and the same offsets can hold different text.
#[derive(Clone, Debug)]
pub enum SelectionFingerprint {
    /// UI Automation identity. The live text ranges pin the logical position —
    /// `IUIAutomationTextRange::Compare` compares endpoints, so identical text
    /// selected at another place is a different range. Screen rectangles are
    /// deliberately not part of the identity: they change when the view
    /// scrolls and say nothing about the logical position.
    Uia {
        control_id: Vec<i32>,
        text: String,
        range: TextRangeIdentity,
    },
    /// Classic edit control. The offsets pin the position inside the control
    /// (never treated as content identity) while `text` — read from the
    /// control itself — proves the selected content is still the source that
    /// was translated.
    Edit {
        start: u32,
        end: u32,
        caret: Option<[i32; 4]>,
        text: String,
    },
}

/// Text copied from a selection together with its identity, when the identity
/// could be read at all.
#[derive(Debug)]
pub struct CapturedSelection {
    pub text: String,
    pub target: Option<SelectionTarget>,
    /// Keeps the thread's COM apartment alive until the live UIA ranges in
    /// `target` are released. Declared last so it is released last.
    pub _apartment: Option<crate::keyboard::ComApartment>,
}

impl SelectionTarget {
    /// The selected source text proven by this identity.
    pub fn source_text(&self) -> &str {
        match &self.fingerprint {
            SelectionFingerprint::Uia { text, .. } | SelectionFingerprint::Edit { text, .. } => {
                text
            }
        }
    }
}

impl SelectionFingerprint {
    pub fn same_as(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::Uia {
                    control_id,
                    text,
                    range,
                },
                Self::Uia {
                    control_id: other_control,
                    text: other_text,
                    range: other_range,
                },
            ) => control_id == other_control && text == other_text && range.same_as(other_range),
            (
                Self::Edit {
                    start,
                    end,
                    caret,
                    text,
                },
                Self::Edit {
                    start: other_start,
                    end: other_end,
                    caret: other_caret,
                    text: other_text,
                },
            ) => {
                start == other_start
                    && end == other_end
                    && caret == other_caret
                    && text == other_text
            }
            _ => false,
        }
    }
}

/// True only while a fresh read proves the captured selection is still the one
/// under the caret. Anything unreadable or different fails closed: the caller
/// must not auto-paste and falls back to the quick result window.
pub fn target_still_valid(captured: &SelectionTarget, now: &SelectionTarget) -> bool {
    captured.window == now.window
        && captured.focus_hwnd == now.focus_hwnd
        && captured.fingerprint.same_as(&now.fingerprint)
}

/// Normalization shared by every capture path so a copied selection and a
/// re-read span compare equal exactly when they are equal in the editor.
pub fn normalize_source_text(text: &str) -> Option<String> {
    let normalized = text.replace("\r\n", "\n").replace(['\r', '\u{2029}'], "\n");
    (!normalized.trim().is_empty()).then_some(normalized)
}

/// Build the classic-edit identity from one control read. The selected span is
/// extracted from the control text so content replaced inside the same offsets
/// is caught; without a readable span the target is unverifiable and the
/// caller must fall back instead of pasting.
pub fn edit_fingerprint(
    control_text: &[u16],
    start: u32,
    end: u32,
    caret: Option<[i32; 4]>,
) -> Option<SelectionFingerprint> {
    if end <= start {
        return None;
    }
    let span = control_text.get(start as usize..end as usize)?;
    let text = normalize_source_text(&String::from_utf16_lossy(span))?;
    Some(SelectionFingerprint::Edit {
        start,
        end,
        caret,
        text,
    })
}
