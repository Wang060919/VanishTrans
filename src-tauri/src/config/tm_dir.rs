//! Custom storage location for the translation memory database.
use super::ApiConfig;
use crate::lock::LockRecover;
use std::path::{Path, PathBuf};

impl ApiConfig {
    /// Configured TM directory; `""` means the default app-data dir.
    pub fn tm_dir(&self) -> String {
        self.tm_dir.lock_recover().clone()
    }

    /// Directory that should hold `tm.db`: the configured override or `default_dir`.
    pub fn tm_db_dir(&self, default_dir: &Path) -> PathBuf {
        let custom = self.tm_dir();
        if custom.trim().is_empty() {
            default_dir.to_path_buf()
        } else {
            PathBuf::from(custom.trim())
        }
    }

    /// Persist a custom TM directory; empty resets to the default.
    /// Takes effect on the next launch — the live connection never moves.
    pub fn set_tm_dir(&self, dir: String) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        *self.tm_dir.lock_recover() = dir;
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }
}
