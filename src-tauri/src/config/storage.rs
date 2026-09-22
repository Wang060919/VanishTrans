use super::{
    credentials::save_api_key_credential, ApiConfig, ConfigSnapshot, PersistedConfig,
    CONFIG_FILE_LOCK,
};
use crate::lock::LockRecover;
use std::sync::atomic::Ordering;

impl ApiConfig {
    pub(crate) fn lock_for_write(&self) -> std::sync::MutexGuard<'_, ()> {
        self.write_lock.lock_recover()
    }

    pub(crate) fn snapshot(&self) -> ConfigSnapshot {
        ConfigSnapshot {
            base_url: self.base_url.lock_recover().clone(),
            api_key: self.api_key.lock_recover().clone(),
            model: self.model.lock_recover().clone(),
            hotkeys: self.hotkeys.lock_recover().clone(),
            glossary: self.glossary.lock_recover().clone(),
            max_records: self.max_records.load(Ordering::Relaxed),
            profiles: self.profiles.lock_recover().clone(),
            free_translation: self.free_translation(),
        }
    }

    pub(crate) fn restore(&self, snapshot: &ConfigSnapshot) {
        *self.base_url.lock_recover() = snapshot.base_url.clone();
        *self.api_key.lock_recover() = snapshot.api_key.clone();
        *self.model.lock_recover() = snapshot.model.clone();
        *self.hotkeys.lock_recover() = snapshot.hotkeys.clone();
        *self.glossary.lock_recover() = snapshot.glossary.clone();
        self.max_records
            .store(snapshot.max_records, Ordering::Relaxed);
        *self.profiles.lock_recover() = snapshot.profiles.clone();
        self.free_translation
            .store(snapshot.free_translation, Ordering::Relaxed);
    }

    pub fn save_to_disk(&self) -> Result<(), String> {
        let _lock = CONFIG_FILE_LOCK.lock_recover();
        let cfg = PersistedConfig {
            base_url: self.base_url.lock_recover().clone(),
            model: self.model.lock_recover().clone(),
            hotkeys: self.hotkeys.lock_recover().clone(),
            glossary: self.glossary.lock_recover().clone(),
            max_records: self.max_records.load(std::sync::atomic::Ordering::Relaxed),
            profiles: self.profiles.lock_recover().clone(),
            free_translation: self.free_translation(),
        };
        if let Some(p) = self.config_path.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("创建配置目录失败: {}", e))?;
        }
        let tmp_path = self.config_path.with_extension("json.tmp");
        let mut value = match serde_json::to_value(&cfg) {
            Ok(value) => value,
            Err(e) => {
                return Err(format!("序列化配置失败: {}", e));
            }
        };
        if let Ok(existing) = std::fs::read_to_string(&self.config_path) {
            if let Ok(serde_json::Value::Object(mut existing)) =
                serde_json::from_str::<serde_json::Value>(&existing)
            {
                if let serde_json::Value::Object(updated) = &value {
                    existing.extend(updated.clone());
                    value = serde_json::Value::Object(existing);
                }
            }
        }
        let json =
            serde_json::to_string_pretty(&value).map_err(|e| format!("序列化配置失败: {}", e))?;
        std::fs::write(&tmp_path, json).map_err(|e| format!("写入临时配置失败: {}", e))?;
        if let Err(e) = std::fs::rename(&tmp_path, &self.config_path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!("替换配置文件失败: {}", e));
        }
        Ok(())
    }

    pub fn save_api_key(&self) -> Result<(), String> {
        let key = self.api_key.lock_recover().clone();
        save_api_key_credential(&key)
    }

    /// Whether the free Google Translate provider is active.
    pub fn free_translation(&self) -> bool {
        self.free_translation
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Toggle the free Google Translate provider and persist the change.
    pub fn set_free_translation(&self, enabled: bool) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        self.free_translation.store(enabled, Ordering::Relaxed);
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }
}
