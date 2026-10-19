use super::*;
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);

#[test]
fn failed_secret_write_restores_session_without_replaying_or_deleting() {
    for original in ["", "fake-existing-session-key"] {
        for replacement in ["", "fake-new-key"] {
            let path = std::env::temp_dir().join(format!(
                "vt-secret-rollback-{}-{}",
                std::process::id(),
                NEXT_DIR.fetch_add(1, Ordering::Relaxed)
            ));
            let state = ApiConfig::load_for_test(path.clone());
            *state.api_key.lock_recover() = original.into();
            let original_url = state.base_url.lock_recover().clone();
            let writes = Cell::new(0);
            let error = set_api_config_with_writer(
                &state,
                "https://example.invalid".into(),
                Some(replacement.into()),
                "fake-model".into(),
                || {
                    writes.set(writes.get() + 1);
                    Err("系统密钥环授权已取消或超时，请重试".into())
                },
            )
            .unwrap_err();
            assert_eq!(writes.get(), 1, "No second mutation after failure");
            assert_eq!(*state.api_key.lock_recover(), original);
            assert_eq!(*state.base_url.lock_recover(), original_url);
            assert_eq!(error.code, "IO");
            let disk = std::fs::read_to_string(path.join("config.json")).unwrap();
            assert!(!disk.contains("fake-new-key"));
            assert!(!disk.contains("fake-existing-session-key"));
            assert!(!disk.contains("api_key"));
            std::fs::remove_dir_all(path).unwrap();
        }
    }
}
