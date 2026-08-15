use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::lock::LockRecover;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TranslationRecord {
    pub id: u64,
    pub original: String,
    pub translated: String,
    pub direction: String,
    pub timestamp: u64,
}

pub struct HistoryStore {
    records: Mutex<Vec<TranslationRecord>>,
    path: std::path::PathBuf,
    next_id: std::sync::atomic::AtomicU64,
    /// Tracks whether records have been added since last flush.
    dirty: AtomicBool,
    /// Maximum records to keep (configurable).
    max_records: AtomicUsize,
}

impl HistoryStore {
    pub fn load_or_default_with_max(config_dir: std::path::PathBuf, max_records: usize) -> Self {
        let path = config_dir.join("history.json");
        let records: Vec<TranslationRecord> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|d| serde_json::from_str(&d).ok())
            .unwrap_or_default();
        let next_id = records.iter().map(|r| r.id).max().unwrap_or(0) + 1;
        Self {
            records: Mutex::new(records),
            path,
            next_id: std::sync::atomic::AtomicU64::new(next_id),
            dirty: AtomicBool::new(false),
            max_records: AtomicUsize::new(max_records),
        }
    }

    pub fn set_max_records(&self, max: usize) {
        self.max_records.store(max, Ordering::Relaxed);
        // Trim existing records if new limit is lower
        let mut records = self.records.lock_recover();
        if records.len() > max {
            let drain_count = records.len() - max;
            records.drain(..drain_count);
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    pub fn add(&self, original: &str, translated: &str, direction: &str) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let record = TranslationRecord {
            id,
            original: original.to_string(),
            translated: translated.to_string(),
            direction: direction.to_string(),
            timestamp,
        };
        let mut records = self.records.lock_recover();
        records.push(record);
        // Keep only the latest max_records
        let limit = self.max_records.load(Ordering::Relaxed);
        if records.len() > limit {
            let drain_count = records.len() - limit;
            records.drain(..drain_count);
        }
        // Mark dirty — actual disk write deferred to periodic flush
        self.dirty.store(true, Ordering::Relaxed);
    }

    /// Flush pending changes to disk. Called periodically and on app shutdown.
    pub fn flush(&self) -> Result<(), String> {
        if !self.dirty.load(Ordering::Relaxed) {
            return Ok(());
        }
        let records = self.records.lock_recover();
        self.save_locked(&records)?;
        self.dirty.store(false, Ordering::Relaxed);
        Ok(())
    }

    pub fn get_all(&self) -> Vec<TranslationRecord> {
        let records = self.records.lock_recover();
        records.iter().rev().cloned().collect()
    }

    pub fn search(&self, query: &str) -> Vec<TranslationRecord> {
        let query_lower = query.to_lowercase();
        let records = self.records.lock_recover();
        records
            .iter()
            .rev()
            .filter(|r| {
                r.original.to_lowercase().contains(&query_lower)
                    || r.translated.to_lowercase().contains(&query_lower)
            })
            .cloned()
            .collect()
    }

    pub fn delete(&self, id: u64) -> Result<(), String> {
        let mut records = self.records.lock_recover();
        let previous = records.clone();
        records.retain(|r| r.id != id);
        if let Err(error) = self.save_locked(&records) {
            *records = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut records = self.records.lock_recover();
        let previous = records.clone();
        records.clear();
        if let Err(error) = self.save_locked(&records) {
            *records = previous;
            return Err(error);
        }
        Ok(())
    }

    fn save_locked(&self, records: &[TranslationRecord]) -> Result<(), String> {
        if let Some(p) = self.path.parent() {
            std::fs::create_dir_all(p).map_err(|error| format!("创建历史目录失败: {error}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(records)
            .map_err(|error| format!("序列化历史记录失败: {error}"))?;
        std::fs::write(&tmp, json).map_err(|error| format!("写入历史临时文件失败: {error}"))?;
        if let Err(error) = std::fs::rename(&tmp, &self.path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("替换历史记录失败: {error}"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    fn temp_store() -> (HistoryStore, std::path::PathBuf) {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vt_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::create_dir_all(&dir);
        let store = HistoryStore::load_or_default_with_max(dir.clone(), 200);
        (store, dir)
    }

    fn cleanup(dir: &std::path::PathBuf) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn add_and_get_all_returns_records_in_reverse_order() {
        let (store, dir) = temp_store();
        store.add("hello", "你好", "en2zh");
        store.add("world", "世界", "en2zh");
        let all = store.get_all();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].translated, "世界");
        assert_eq!(all[1].translated, "你好");
        cleanup(&dir);
    }

    #[test]
    fn search_finds_matching_original() {
        let (store, dir) = temp_store();
        store.add("hello world", "你好世界", "en2zh");
        store.add("goodbye", "再见", "en2zh");
        let results = store.search("hello");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].original, "hello world");
        cleanup(&dir);
    }

    #[test]
    fn search_finds_matching_translated() {
        let (store, dir) = temp_store();
        store.add("hello", "你好世界", "en2zh");
        store.add("goodbye", "再见", "en2zh");
        let results = store.search("你好");
        assert_eq!(results.len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn search_is_case_insensitive() {
        let (store, dir) = temp_store();
        store.add("Hello World", "你好", "en2zh");
        let results = store.search("hello");
        assert_eq!(results.len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn delete_removes_specific_record() {
        let (store, dir) = temp_store();
        store.add("a", "甲", "en2zh");
        store.add("b", "乙", "en2zh");
        let all = store.get_all();
        let id_to_delete = all[1].id;
        store.delete(id_to_delete).unwrap();
        let remaining = store.get_all();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].original, "b");
        cleanup(&dir);
    }

    #[test]
    fn clear_removes_all_records() {
        let (store, dir) = temp_store();
        store.add("a", "甲", "en2zh");
        store.add("b", "乙", "en2zh");
        store.clear().unwrap();
        let all = store.get_all();
        assert!(all.is_empty());
        cleanup(&dir);
    }

    #[test]
    fn max_records_is_enforced() {
        let dir = std::env::temp_dir().join(format!("vt_test_limit_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let store = HistoryStore::load_or_default_with_max(dir.clone(), 100);
        for i in 0..105 {
            store.add(&format!("text{}", i), &format!("翻译{}", i), "auto2zh");
        }
        let all = store.get_all();
        assert_eq!(all.len(), 100);
        assert_eq!(all[0].original, "text104");
        cleanup(&dir);
    }

    #[test]
    fn empty_search_returns_all() {
        let (store, dir) = temp_store();
        store.add("a", "甲", "en2zh");
        store.add("b", "乙", "en2zh");
        let results = store.search("");
        assert_eq!(results.len(), 2);
        cleanup(&dir);
    }

    #[test]
    fn flush_persists_recent_records_before_exit() {
        let dir = std::env::temp_dir().join(format!(
            "vt_history_flush_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = HistoryStore::load_or_default_with_max(dir.clone(), 200);
        store.add("recent", "最近", "en2zh");
        store.flush().unwrap();
        drop(store);

        let reloaded = HistoryStore::load_or_default_with_max(dir.clone(), 200);
        assert_eq!(reloaded.get_all().len(), 1);
        assert_eq!(reloaded.get_all()[0].translated, "最近");
        drop(reloaded);
        cleanup(&dir);
    }

    #[test]
    fn failed_flush_stays_dirty_and_can_be_retried() {
        let base = std::env::temp_dir().join(format!(
            "vt_history_retry_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&base, b"not a directory").unwrap();
        let store = HistoryStore::load_or_default_with_max(base.clone(), 200);
        store.add("retry", "重试", "en2zh");

        assert!(store.flush().is_err());
        assert!(store.dirty.load(Ordering::Relaxed));

        std::fs::remove_file(&base).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        store.flush().unwrap();
        assert!(!store.dirty.load(Ordering::Relaxed));

        drop(store);
        cleanup(&base);
    }
}
