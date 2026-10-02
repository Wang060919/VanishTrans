use crate::keyboard;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReplaceSelectionError {
    FocusChanged,
    ClipboardWrite(String),
    PasteInputRejected,
    /// The keys were injected but the target's content never changed, so the
    /// paste cannot be proven to have landed.
    PasteUnconfirmed,
}

impl std::fmt::Display for ReplaceSelectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FocusChanged => write!(formatter, "前台窗口已切换，已取消原地替换"),
            Self::ClipboardWrite(error) => write!(formatter, "写入剪贴板失败: {error}"),
            Self::PasteInputRejected => write!(formatter, "系统未接受粘贴按键"),
            Self::PasteUnconfirmed => write!(formatter, "粘贴未被目标应用接受"),
        }
    }
}

pub(super) fn replace_clipboard_and_paste<CheckFocus, WriteClipboard, Paste, AfterPaste, Restore>(
    mut original_window_is_current: CheckFocus,
    write_clipboard: WriteClipboard,
    paste: Paste,
    after_paste: AfterPaste,
    restore_clipboard: Restore,
) -> Result<(), ReplaceSelectionError>
where
    CheckFocus: FnMut() -> bool,
    WriteClipboard: FnOnce() -> Result<(), String>,
    Paste: FnOnce() -> bool,
    AfterPaste: FnOnce() -> bool,
    Restore: FnOnce(),
{
    if !original_window_is_current() {
        return Err(ReplaceSelectionError::FocusChanged);
    }

    let mut restore_clipboard = Some(restore_clipboard);
    let restore = |restore_clipboard: &mut Option<Restore>| {
        if let Some(restore_clipboard) = restore_clipboard.take() {
            restore_clipboard();
        }
    };

    if let Err(error) = write_clipboard() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::ClipboardWrite(error));
    }

    if !original_window_is_current() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::FocusChanged);
    }

    if !paste() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::PasteInputRejected);
    }

    // SendInput returning true only means the keys were injected. The paste
    // is confirmed once `after_paste` observes the target's content change;
    // otherwise nothing may have been replaced and the run is a failure.
    if !after_paste() {
        restore(&mut restore_clipboard);
        return Err(ReplaceSelectionError::PasteUnconfirmed);
    }

    restore(&mut restore_clipboard);
    Ok(())
}

/// Where a failed replace attempt hands its content.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReplacementDelivery<'a> {
    /// Nothing was translated yet: the quick window translates the source once.
    TranslateSource(&'a str),
    /// A translation already exists: deliver it as-is. Handing it to the
    /// translation channel would burn a second API call re-translating it.
    ShowResult { source: &'a str, text: &'a str },
}

pub(super) fn delivery_for_failure<'a>(
    translated: Option<&'a str>,
    source: &'a str,
) -> ReplacementDelivery<'a> {
    match translated {
        Some(text) => ReplacementDelivery::ShowResult { source, text },
        None => ReplacementDelivery::TranslateSource(source),
    }
}

/// The captured selection is the only thing Alt+R may replace. `None` means
/// the identity is missing or belongs to another window: never paste.
pub(super) fn replacement_target(
    captured: &crate::selection::CapturedSelection,
    original_window: keyboard::ForegroundWindowToken,
) -> Option<crate::selection::SelectionTarget> {
    captured
        .target
        .clone()
        .filter(|candidate| candidate.window == original_window)
}

/// Conservative Alt+R outcome: never paste, hand the content to the quick
/// result window instead.
pub(super) fn deliver_to_quick_window(
    app: &tauri::AppHandle,
    delivery: ReplacementDelivery<'_>,
    reason: &str,
) {
    log::info!("[alt-r] {reason}; showing the quick result window instead of pasting");
    // Claim the quick-window generation only when a delivery actually
    // happens: a successful paste or an early return must not invalidate an
    // in-flight quick request.
    let quick_seq = crate::commands::claim_quick_request();
    let result = match delivery {
        ReplacementDelivery::TranslateSource(source) => {
            crate::commands::show_quick_translation_if_current(app, source.to_string(), quick_seq)
        }
        ReplacementDelivery::ShowResult { source, text } => {
            crate::commands::show_quick_result(app, source.to_string(), text.to_string(), quick_seq)
        }
    };
    if let Err(error) = result {
        log::warn!("[alt-r] Failed to show quick window: {error}");
    }
}
