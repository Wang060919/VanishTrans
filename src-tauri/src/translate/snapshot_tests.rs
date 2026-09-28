use super::request::{build_translation_prompt, validate_and_get_config};
use crate::config::ApiConfig;
use crate::lock::LockRecover;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

struct Fixture {
    config: ApiConfig,
    dir: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vt_snapshot_{}_{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let config = ApiConfig::load_for_test(dir.clone());
        Self { config, dir }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.dir).expect("remove isolated snapshot fixture");
    }
}

fn set_settings(config: &ApiConfig, suffix: &str) {
    let _guard = config.lock_for_write();
    *config.base_url.lock_recover() = format!("https://{suffix}.invalid");
    *config.api_key.lock_recover() = format!("test-key-{suffix}");
    *config.model.lock_recover() = format!("model-{suffix}");
    *config.glossary.lock_recover() = vec![("source".into(), suffix.into())];
    config
        .free_translation
        .store(suffix == "b", Ordering::Relaxed);
}

#[test]
fn snapshot_keeps_cache_credentials_prompt_and_provider_together() {
    let fixture = Fixture::new();
    let config = &fixture.config;
    set_settings(config, "a");
    let snapshot = config.translation_snapshot();
    let hash = snapshot.context_hash();

    // A setting change between cache lookup and provider dispatch must not alter A.
    set_settings(config, "b");
    let request = validate_and_get_config(&snapshot, "source").unwrap();
    assert_eq!(request.base_url, "https://a.invalid");
    assert_eq!(request.api_key, "test-key-a");
    assert_eq!(request.model, "model-a");
    assert!(!snapshot.free_translation);
    let prompt = build_translation_prompt(&snapshot, "source", "auto", "Chinese");
    assert!(prompt.system_prompt.contains("\"source\" → \"a\""));
    assert_eq!(snapshot.context_hash(), hash);
    assert_ne!(config.translation_context_hash(), hash);

    // Credentials do not change the established cache partition.
    let mut changed_key = snapshot.clone();
    changed_key.api_key = "another-test-key".into();
    assert_eq!(changed_key.context_hash(), hash);
}

#[test]
fn snapshot_waits_for_an_entire_settings_write() {
    let fixture = Fixture::new();
    let config = &fixture.config;
    set_settings(config, "a");
    std::thread::scope(|scope| {
        let guard = config.lock_for_write();
        *config.api_key.lock_recover() = "test-key-b".into();
        let (started_tx, started_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        let reader = scope.spawn(move || {
            started_tx.send(()).unwrap();
            result_tx.send(config.translation_snapshot()).unwrap();
        });
        started_rx.recv().unwrap();
        let pending = result_rx.recv_timeout(Duration::from_millis(50));
        *config.base_url.lock_recover() = "https://b.invalid".into();
        *config.model.lock_recover() = "model-b".into();
        drop(guard);
        let snapshot = result_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        reader.join().unwrap();
        assert!(matches!(pending, Err(mpsc::RecvTimeoutError::Timeout)));
        assert_eq!(snapshot.api_key, "test-key-b");
        assert_eq!(snapshot.base_url, "https://b.invalid");
        assert_eq!(snapshot.model, "model-b");
    });
}
