use std::sync::Mutex;

use super::alt_flows::try_alt_r_lock;
use super::registry::{
    parse_shortcut, register_available_shortcuts, unregister_all, validate_shortcuts,
    ShortcutRegistrationConflict,
};
use super::replace_flow::{
    delivery_for_failure, replace_clipboard_and_paste, replacement_target, ReplaceSelectionError,
    ReplacementDelivery,
};
use crate::keyboard;

#[test]
fn parses_supported_shortcuts() {
    assert!(parse_shortcut("Alt+Q").is_ok());
    assert!(parse_shortcut("Ctrl+Shift+Space").is_ok());
    assert!(parse_shortcut("Meta+1").is_ok());
}

#[test]
fn rejects_shortcuts_without_modifier_or_unsupported_keys() {
    assert!(parse_shortcut("Q").is_err());
    assert!(parse_shortcut("Alt+↑").is_err());
    assert!(parse_shortcut("Alt+F1").is_err());
}

#[test]
fn rejects_shortcuts_with_multiple_key_parts() {
    // A second non-modifier part must be an error, not silently win.
    assert!(parse_shortcut("Ctrl+Q+W").is_err());
    assert!(parse_shortcut("Alt+1+2").is_err());
    assert!(parse_shortcut("Alt+Q+Q").is_err());
}

#[test]
fn rejects_duplicate_actions_and_shortcuts() {
    assert!(validate_shortcuts(&[
        ("translate".into(), "Alt+Q".into()),
        ("translate".into(), "Alt+W".into()),
    ])
    .is_err());
    assert!(validate_shortcuts(&[
        ("translate".into(), "Alt+Q".into()),
        ("replace".into(), "Alt+Q".into()),
    ])
    .is_err());
}

#[test]
fn registration_keeps_available_shortcuts_when_one_conflicts() {
    let validated = validate_shortcuts(&[
        ("translate".into(), "Alt+Q".into()),
        ("replace".into(), "Alt+R".into()),
        ("screenshot".into(), "Alt+W".into()),
    ])
    .unwrap();
    let conflicting = parse_shortcut("Alt+R").unwrap();

    let (registered, conflicts) = register_available_shortcuts(validated, |shortcut| {
        if shortcut == conflicting {
            Err("already registered".into())
        } else {
            Ok(())
        }
    });

    assert_eq!(registered.len(), 2);
    assert!(registered.iter().any(|(_, action)| action == "translate"));
    assert!(registered.iter().any(|(_, action)| action == "screenshot"));
    assert_eq!(
        conflicts,
        vec![ShortcutRegistrationConflict {
            action: "replace".into(),
            shortcut: "Alt+R".into(),
            error: "already registered".into(),
        }]
    );
}

#[test]
fn unregister_all_keeps_entries_the_os_refused_to_release() {
    let stuck = parse_shortcut("Alt+R").unwrap();
    let released = parse_shortcut("Alt+Q").unwrap();
    let retained = unregister_all(
        vec![
            (released, "translate".to_string()),
            (stuck, "replace".to_string()),
        ],
        |shortcut| -> Result<(), String> {
            if shortcut == stuck {
                Err("still held".into())
            } else {
                Ok(())
            }
        },
    );
    assert_eq!(retained, vec![(stuck, "replace".to_string())]);
}

#[test]
fn replacement_never_writes_after_focus_changed() {
    use std::cell::Cell;

    let wrote = Cell::new(false);
    let pasted = Cell::new(false);
    let restored = Cell::new(false);
    let result = replace_clipboard_and_paste(
        || false,
        || {
            wrote.set(true);
            Ok(())
        },
        || {
            pasted.set(true);
            true
        },
        || true,
        || restored.set(true),
    );

    assert_eq!(result, Err(ReplaceSelectionError::FocusChanged));
    assert!(!wrote.get());
    assert!(!pasted.get());
    assert!(!restored.get());
}

#[test]
fn replacement_restores_clipboard_when_focus_changes_before_paste() {
    use std::cell::Cell;

    let focus_checks = Cell::new(0);
    let pasted = Cell::new(false);
    let restored = Cell::new(false);
    let result = replace_clipboard_and_paste(
        || {
            let check = focus_checks.get();
            focus_checks.set(check + 1);
            check == 0
        },
        || Ok(()),
        || {
            pasted.set(true);
            true
        },
        || true,
        || restored.set(true),
    );

    assert_eq!(result, Err(ReplaceSelectionError::FocusChanged));
    assert!(!pasted.get());
    assert!(restored.get());
}

#[test]
fn replacement_restores_clipboard_on_write_and_paste_failures() {
    use std::cell::Cell;

    let write_restore_count = Cell::new(0);
    let write_result = replace_clipboard_and_paste(
        || true,
        || Err("locked".into()),
        || true,
        || true,
        || write_restore_count.set(write_restore_count.get() + 1),
    );
    assert_eq!(
        write_result,
        Err(ReplaceSelectionError::ClipboardWrite("locked".into()))
    );
    assert_eq!(write_restore_count.get(), 1);

    let paste_restore_count = Cell::new(0);
    let paste_result = replace_clipboard_and_paste(
        || true,
        || Ok(()),
        || false,
        || true,
        || paste_restore_count.set(paste_restore_count.get() + 1),
    );
    assert_eq!(paste_result, Err(ReplaceSelectionError::PasteInputRejected));
    assert_eq!(paste_restore_count.get(), 1);
}

#[test]
fn successful_replacement_restores_clipboard_after_paste() {
    use std::cell::Cell;

    let pasted = Cell::new(false);
    let restored_after_paste = Cell::new(false);
    let result = replace_clipboard_and_paste(
        || true,
        || Ok(()),
        || {
            pasted.set(true);
            true
        },
        || {
            assert!(pasted.get());
            true
        },
        || restored_after_paste.set(pasted.get()),
    );

    assert_eq!(result, Ok(()));
    assert!(restored_after_paste.get());
}

#[test]
fn unconfirmed_paste_restores_clipboard_and_reports_failure() {
    use std::cell::Cell;

    let pasted = Cell::new(false);
    let restored = Cell::new(false);
    let result = replace_clipboard_and_paste(
        || true,
        || Ok(()),
        || {
            pasted.set(true);
            true
        },
        || false, // target content never changed after the injected keys
        || restored.set(true),
    );

    assert_eq!(result, Err(ReplaceSelectionError::PasteUnconfirmed));
    assert!(pasted.get());
    assert!(restored.get());
}

#[test]
fn post_translation_fallback_delivers_the_existing_result() {
    assert_eq!(
        delivery_for_failure(Some("译文"), "hello"),
        ReplacementDelivery::ShowResult {
            source: "hello",
            text: "译文"
        }
    );
    assert_eq!(
        delivery_for_failure(None, "hello"),
        ReplacementDelivery::TranslateSource("hello")
    );
}

#[test]
fn alt_r_lock_recovers_after_a_panicked_holder() {
    let lock = Mutex::new(());
    // Poison the mutex exactly the way a panicking worker would.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = lock.lock().unwrap();
        panic!("simulated worker panic");
    }));
    assert!(lock.is_poisoned());
    assert!(
        try_alt_r_lock(&lock).is_some(),
        "a poisoned-but-free lock must be recovered, not dead forever"
    );
}

#[test]
fn alt_r_lock_still_serializes_concurrent_runs() {
    let lock = Mutex::new(());
    let guard = try_alt_r_lock(&lock).expect("free lock must be granted");
    assert!(try_alt_r_lock(&lock).is_none());
    drop(guard);
    assert!(try_alt_r_lock(&lock).is_some());
}

#[test]
fn unverifiable_identity_never_reaches_the_paste_flow() {
    use std::cell::Cell;

    let original = keyboard::ForegroundWindowToken::from_raw(1);
    let captured = crate::selection::CapturedSelection {
        text: "hello".into(),
        target: None,
        _apartment: None,
    };
    let pasted = Cell::new(false);
    let mut delivered: Option<ReplacementDelivery<'_>> = None;
    // The same routing handle_alt_r performs: without a target the paste
    // flow is never entered and the source goes to the quick window.
    if let Some(target) = replacement_target(&captured, original) {
        let _ = replace_clipboard_and_paste(
            || keyboard::target_is_unchanged(&target),
            || Ok(()),
            || {
                pasted.set(true);
                true
            },
            || true,
            || {},
        );
    } else {
        delivered = Some(delivery_for_failure(None, &captured.text));
    }
    assert!(!pasted.get());
    assert!(matches!(
        delivered,
        Some(ReplacementDelivery::TranslateSource("hello"))
    ));

    // A captured identity from another window is equally unusable.
    let foreign = crate::selection::CapturedSelection {
        text: "hello".into(),
        target: Some(crate::selection::SelectionTarget {
            window: keyboard::ForegroundWindowToken::from_raw(2),
            focus_hwnd: None,
            fingerprint: crate::selection::SelectionFingerprint::Edit {
                start: 0,
                end: 5,
                caret: None,
                text: "hello".into(),
            },
        }),
        _apartment: None,
    };
    assert!(replacement_target(&foreign, original).is_none());
}
