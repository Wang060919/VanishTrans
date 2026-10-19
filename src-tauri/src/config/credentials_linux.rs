//! Persistent Secret Service storage; never fall back to a session collection/file.
use dbus_secret_service::{EncryptionType, Error, SecretService};
use std::collections::HashMap;

const SERVICE: &str = "VanishTrans";
const ACCOUNT: &str = "api-key";

fn attributes() -> HashMap<&'static str, &'static str> {
    HashMap::from([("application", SERVICE), ("account", ACCOUNT)])
}

// Never format provider errors: they can carry arbitrary remote data/secrets.
fn storage_error(error: Error) -> String {
    let reason = match error {
        Error::Locked => "系统密钥环已锁定，请解锁后重试",
        Error::Prompt => "系统密钥环授权已取消或超时，请重试",
        Error::Unavailable | Error::NoResult => "系统 Secret Service 或默认密钥环不可用",
        _ => "无法访问系统 Secret Service，请检查密钥环后重试",
    };
    reason.into()
}

trait CredentialStore {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, key: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

struct SystemStore;
impl SystemStore {
    fn connect(prompt_seconds: u64) -> Result<SecretService, String> {
        SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, prompt_seconds)
            .map_err(storage_error)
    }
}

impl CredentialStore for SystemStore {
    fn read(&self) -> Result<Option<String>, String> {
        // Startup must not wait for an unlock prompt. Unlock externally and restart.
        let service = Self::connect(0)?;
        let collection = service.get_default_collection().map_err(storage_error)?;
        if collection.is_locked().map_err(storage_error)? {
            return Err(storage_error(Error::Locked));
        }
        let items = collection
            .search_items(attributes())
            .map_err(storage_error)?;
        match items.as_slice() {
            [] => Ok(None),
            [item] => {
                let bytes = item.get_secret().map_err(storage_error)?;
                String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| "系统密钥环中的 API Key 编码无效".into())
            }
            _ => Err("系统密钥环中有重复的 VanishTrans API Key，请先检查密钥环".into()),
        }
    }

    fn write(&self, key: &str) -> Result<(), String> {
        let service = Self::connect(30)?;
        let collection = service.get_default_collection().map_err(storage_error)?;
        collection.ensure_unlocked().map_err(storage_error)?;
        let items = collection
            .search_items(attributes())
            .map_err(storage_error)?;
        match items.as_slice() {
            [] => collection
                .create_item(
                    "VanishTrans API Key",
                    attributes(),
                    key.as_bytes(),
                    false,
                    "text/plain",
                )
                .map(|_| ())
                .map_err(storage_error),
            [item] => {
                item.ensure_unlocked().map_err(storage_error)?;
                item.set_secret(key.as_bytes(), "text/plain")
                    .map_err(storage_error)
            }
            _ => Err("系统密钥环中有重复的 VanishTrans API Key，未覆盖任何凭据".into()),
        }
    }

    fn delete(&self) -> Result<(), String> {
        let service = Self::connect(30)?;
        let collection = service.get_default_collection().map_err(storage_error)?;
        collection.ensure_unlocked().map_err(storage_error)?;
        let items = collection
            .search_items(attributes())
            .map_err(storage_error)?;
        match items.as_slice() {
            [] => Ok(()),
            [item] => {
                item.ensure_unlocked().map_err(storage_error)?;
                item.delete().map_err(storage_error)
            }
            _ => Err("系统密钥环中有重复的 VanishTrans API Key，未删除任何凭据".into()),
        }
    }
}

fn save_with(store: &impl CredentialStore, key: &str) -> Result<(), String> {
    if key.is_empty() {
        store.delete()
    } else {
        store.write(key)
    }
}

pub(super) fn save_api_key_credential(key: &str) -> Result<(), String> {
    save_with(&SystemStore, key)
}

pub(super) fn load_api_key_credential() -> Result<Option<String>, String> {
    SystemStore.read()
}

#[cfg(test)]
#[path = "credentials_linux_tests.rs"]
mod tests;
