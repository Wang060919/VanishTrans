use super::{ApiConfig, ServiceProfile};
use crate::lock::LockRecover;

impl ApiConfig {
    pub fn upsert_profile(&self, profile: ServiceProfile) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let mut profiles = self.profiles.lock_recover();
        if let Some(existing) = profiles
            .iter_mut()
            .find(|existing| existing.name == profile.name)
        {
            *existing = profile;
        } else {
            profiles.push(profile);
        }
        drop(profiles);
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }

    pub fn delete_profile(&self, name: &str) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let mut profiles = self.profiles.lock_recover();
        profiles.retain(|profile| profile.name != name);
        drop(profiles);
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }

    pub fn apply_profile(&self, name: &str) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let profile = self
            .profiles
            .lock_recover()
            .iter()
            .find(|profile| profile.name == name)
            .cloned()
            .ok_or_else(|| format!("找不到服务档案: {}", name))?;
        *self.base_url.lock_recover() = profile.base_url;
        *self.model.lock_recover() = profile.model;
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }
}
