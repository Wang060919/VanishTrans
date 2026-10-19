use super::*;
use std::cell::RefCell;

#[derive(Default)]
struct FakeStore {
    key: RefCell<Option<String>>,
    operations: RefCell<Vec<&'static str>>,
    failure: Option<&'static str>,
}

impl CredentialStore for FakeStore {
    fn read(&self) -> Result<Option<String>, String> {
        self.operations.borrow_mut().push("read");
        self.failure
            .map_or_else(|| Ok(self.key.borrow().clone()), |e| Err(e.into()))
    }
    fn write(&self, key: &str) -> Result<(), String> {
        self.operations.borrow_mut().push("write");
        if let Some(error) = self.failure {
            return Err(error.into());
        }
        *self.key.borrow_mut() = Some(key.into());
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        self.operations.borrow_mut().push("delete");
        if let Some(error) = self.failure {
            return Err(error.into());
        }
        *self.key.borrow_mut() = None;
        Ok(())
    }
}

#[test]
fn persists_updates_reads_and_clears_only_the_selected_entry() {
    let store = FakeStore::default();
    assert_eq!(store.read().unwrap(), None);
    save_with(&store, "fake-first-key").unwrap();
    assert_eq!(store.read().unwrap().as_deref(), Some("fake-first-key"));
    save_with(&store, "fake-replacement-key").unwrap();
    assert_eq!(
        store.read().unwrap().as_deref(),
        Some("fake-replacement-key")
    );
    save_with(&store, "").unwrap();
    save_with(&store, "").unwrap();
    assert_eq!(store.read().unwrap(), None);
}

#[test]
fn failures_never_claim_success_or_retry_mutation() {
    for failure in ["missing service", "locked", "cancelled", "timeout"] {
        for key in ["fake-new-key", ""] {
            let store = FakeStore {
                key: RefCell::new(Some("fake-existing-key".into())),
                failure: Some(failure),
                ..Default::default()
            };
            assert_eq!(save_with(&store, key).unwrap_err(), failure);
            assert_eq!(store.key.borrow().as_deref(), Some("fake-existing-key"));
            assert_eq!(store.operations.borrow().len(), 1);
            assert!(store.read().is_err());
        }
    }
}

#[test]
fn error_messages_never_echo_remote_details_or_secret_bytes() {
    let message = storage_error(Error::Path("fake-sensitive-key".into()));
    assert!(!message.contains("fake-sensitive-key"));
    assert!(storage_error(Error::Locked).contains("锁定"));
    assert!(storage_error(Error::Prompt).contains("取消或超时"));
    assert!(storage_error(Error::Unavailable).contains("不可用"));
}
