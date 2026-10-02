use super::{ApiConfig, ServiceProfile};
use crate::lock::LockRecover;

/// `apply_profile` refuses to load a stored profile whose URL could never
/// satisfy `set_api_config`'s scheme rule, so a hand-edited config.json cannot
/// poison the live settings.
fn usable_base_url(base_url: &str) -> bool {
    base_url.starts_with("http://") || base_url.starts_with("https://")
}

impl ApiConfig {
    /// Insert or replace a profile and return the persisted list read while
    /// still holding the write lock, so callers never observe a torn list.
    pub fn upsert_profile(&self, profile: ServiceProfile) -> Result<Vec<ServiceProfile>, String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let updated = {
            let mut profiles = self.profiles.lock_recover();
            if let Some(existing) = profiles
                .iter_mut()
                .find(|existing| existing.name == profile.name)
            {
                *existing = profile;
            } else {
                profiles.push(profile);
            }
            profiles.clone()
        };
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(updated)
    }

    /// Remove a profile and return the persisted list read under the write lock.
    pub fn delete_profile(&self, name: &str) -> Result<Vec<ServiceProfile>, String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let updated = {
            let mut profiles = self.profiles.lock_recover();
            profiles.retain(|profile| profile.name != name);
            profiles.clone()
        };
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(updated)
    }

    /// Apply a stored profile and return it. The profile travels inside the
    /// write lock, so a concurrent `delete_profile` can never make a
    /// successful apply report not-found.
    pub fn apply_profile(&self, name: &str) -> Result<ServiceProfile, String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let profile = self
            .profiles
            .lock_recover()
            .iter()
            .find(|profile| profile.name == name)
            .cloned()
            .ok_or_else(|| format!("找不到服务档案: {}", name))?;
        if !usable_base_url(&profile.base_url) {
            return Err(format!(
                "服务档案 {} 的 Base URL 无效（必须以 http:// 或 https:// 开头）",
                profile.name
            ));
        }
        *self.base_url.lock_recover() = profile.base_url.clone();
        *self.model.lock_recover() = profile.model.clone();
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(profile)
    }
}
