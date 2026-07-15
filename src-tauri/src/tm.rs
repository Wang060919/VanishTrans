use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TmEntry {
    pub id: i64,
    pub source: String,
    pub target: String,
    pub source_lang: String,
    pub target_lang: String,
    pub created_at: i64,
    pub hit_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TmStats {
    pub total_entries: usize,
    pub total_hits: i64,
}

pub struct TranslationMemory {
    conn: Mutex<Connection>,
}

/// Recover from a poisoned mutex by consuming the poison and returning the inner value.
fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl TranslationMemory {
    /// Open or create the TM database in the given config directory.
    pub fn open(config_dir: &Path) -> Result<Self, String> {
        let db_path = config_dir.join("tm.db");
        let conn =
            Connection::open(&db_path).map_err(|e| format!("打开翻译记忆数据库失败: {}", e))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS translation_memory (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 source TEXT NOT NULL,
                 target TEXT NOT NULL,
                 source_lang TEXT NOT NULL DEFAULT '',
                 target_lang TEXT NOT NULL DEFAULT '',
                 created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                 hit_count INTEGER NOT NULL DEFAULT 0,
                 UNIQUE(source, source_lang, target_lang)
             );
             CREATE INDEX IF NOT EXISTS idx_tm_source ON translation_memory(source);",
        )
        .map_err(|e| format!("初始化翻译记忆表失败: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Internal store method — caller must already hold the lock.
    fn store_inner(
        conn: &Connection,
        source: &str,
        target: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO translation_memory (source, target, source_lang, target_lang)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(source, source_lang, target_lang)
             DO UPDATE SET target = excluded.target",
            params![source, target, source_lang, target_lang],
        )
    }

    /// Look up an exact match in the TM. Returns the translation if found.
    pub fn lookup(&self, source: &str, source_lang: &str, target_lang: &str) -> Option<String> {
        let conn = lock_or_recover(&self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, target FROM translation_memory
                 WHERE source = ?1 AND source_lang = ?2 AND target_lang = ?3
                 LIMIT 1",
            )
            .ok()?;

        let mut rows = stmt.query(params![source, source_lang, target_lang]).ok()?;
        if let Some(row) = rows.next().ok()? {
            let id: i64 = row.get(0).ok()?;
            let target: String = row.get(1).ok()?;
            let _ = conn.execute(
                "UPDATE translation_memory SET hit_count = hit_count + 1 WHERE id = ?1",
                params![id],
            );
            Some(target)
        } else {
            None
        }
    }

    /// Store a translation in the TM (UPSERT).
    pub fn store(&self, source: &str, target: &str, source_lang: &str, target_lang: &str) {
        let conn = lock_or_recover(&self.conn);
        if let Err(e) = Self::store_inner(&conn, source, target, source_lang, target_lang) {
            log::error!("[tm] Failed to store translation: {}", e);
        }
    }

    /// Search TM entries by source or target text.
    pub fn search(&self, query: &str) -> Vec<TmEntry> {
        let conn = lock_or_recover(&self.conn);
        let sql = if query.is_empty() {
            "SELECT id, source, target, source_lang, target_lang, created_at, hit_count
             FROM translation_memory ORDER BY created_at DESC LIMIT 200"
        } else {
            "SELECT id, source, target, source_lang, target_lang, created_at, hit_count
             FROM translation_memory
             WHERE source LIKE ?1 OR target LIKE ?1
             ORDER BY hit_count DESC, created_at DESC LIMIT 200"
        };

        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let pattern = if query.is_empty() {
            String::new()
        } else {
            format!("%{}%", query)
        };

        let rows = if query.is_empty() {
            stmt.query([])
        } else {
            stmt.query(params![pattern])
        };

        let mut entries = Vec::new();
        if let Ok(mut rows) = rows {
            while let Ok(Some(row)) = rows.next() {
                entries.push(TmEntry {
                    id: row.get(0).unwrap_or(0),
                    source: row.get(1).unwrap_or_default(),
                    target: row.get(2).unwrap_or_default(),
                    source_lang: row.get(3).unwrap_or_default(),
                    target_lang: row.get(4).unwrap_or_default(),
                    created_at: row.get(5).unwrap_or(0),
                    hit_count: row.get(6).unwrap_or(0),
                });
            }
        }
        entries
    }

    /// Delete a single TM entry by ID.
    pub fn delete(&self, id: i64) {
        let conn = lock_or_recover(&self.conn);
        let _ = conn.execute("DELETE FROM translation_memory WHERE id = ?1", params![id]);
    }

    /// Clear all TM entries.
    pub fn clear(&self) {
        let conn = lock_or_recover(&self.conn);
        let _ = conn.execute("DELETE FROM translation_memory", []);
    }

    /// Get TM statistics.
    pub fn stats(&self) -> TmStats {
        let conn = lock_or_recover(&self.conn);
        let total_entries: usize = conn
            .query_row("SELECT COUNT(*) FROM translation_memory", [], |r| r.get(0))
            .unwrap_or(0);
        let total_hits: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(hit_count), 0) FROM translation_memory",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        TmStats {
            total_entries,
            total_hits,
        }
    }

    /// Export TM to CSV (with UTF-8 BOM for Excel compatibility).
    pub fn export_csv(&self, path: &Path) -> Result<usize, String> {
        let entries = self.all_entries()?;
        let count = entries.len();
        let mut content = String::from("\u{FEFF}");
        let mut wtr = csv::Writer::from_writer(Vec::new());
        wtr.write_record(["source", "target", "source_lang", "target_lang"])
            .map_err(|e| format!("写入 CSV 表头失败: {}", e))?;
        for entry in &entries {
            wtr.serialize((
                &entry.source,
                &entry.target,
                &entry.source_lang,
                &entry.target_lang,
            ))
            .map_err(|e| format!("序列化 CSV 失败: {}", e))?;
        }
        wtr.flush().map_err(|e| format!("flush CSV 失败: {}", e))?;
        let csv_data = String::from_utf8(wtr.into_inner().unwrap_or_default())
            .map_err(|e| format!("CSV 编码失败: {}", e))?;
        content.push_str(&csv_data);
        std::fs::write(path, content).map_err(|e| format!("写入 CSV 文件失败: {}", e))?;
        Ok(count)
    }

    fn all_entries(&self) -> Result<Vec<TmEntry>, String> {
        let conn = lock_or_recover(&self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, source, target, source_lang, target_lang, created_at, hit_count
                 FROM translation_memory ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("读取翻译记忆失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TmEntry {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    target: row.get(2)?,
                    source_lang: row.get(3)?,
                    target_lang: row.get(4)?,
                    created_at: row.get(5)?,
                    hit_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("读取翻译记忆失败: {}", e))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("读取翻译记忆失败: {}", e))
    }

    /// Import TM from CSV (source, target, source_lang, target_lang).
    /// Acquires lock once and inserts directly — avoids R1 deadlock.
    pub fn import_csv(&self, path: &Path) -> Result<usize, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("读取 CSV 文件失败: {}", e))?;
        self.import_csv_reader(file)
    }

    pub fn import_csv_content(&self, content: &str) -> Result<usize, String> {
        self.import_csv_reader(content.as_bytes())
    }

    fn import_csv_reader<R: std::io::Read>(&self, reader: R) -> Result<usize, String> {
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(reader);

        let conn = lock_or_recover(&self.conn);
        let mut count = 0;
        for (index, result) in rdr.records().enumerate() {
            let record = result.map_err(|e| format!("解析 CSV 行失败: {}", e))?;
            if record.len() >= 2 {
                let source = record[0].trim_start_matches('\u{FEFF}').to_string();
                let target = record[1].to_string();
                if index == 0
                    && source.eq_ignore_ascii_case("source")
                    && target.eq_ignore_ascii_case("target")
                {
                    continue;
                }
                if source.is_empty() {
                    continue;
                }
                let source_lang = record.get(2).unwrap_or("").to_string();
                let target_lang = record.get(3).unwrap_or("").to_string();
                Self::store_inner(&conn, &source, &target, &source_lang, &target_lang)
                    .map_err(|e| format!("导入翻译记忆失败: {}", e))?;
                count += 1;
            }
        }
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_tm() -> (TranslationMemory, std::path::PathBuf) {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vt_tm_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (TranslationMemory::open(&dir).unwrap(), dir)
    }

    #[test]
    fn export_includes_entries_beyond_search_limit() {
        let (tm, dir) = temp_tm();
        for i in 0..205 {
            tm.store(
                &format!("source-{i}"),
                &format!("target-{i}"),
                "auto",
                "Chinese",
            );
        }
        let path = dir.join("export.csv");
        assert_eq!(tm.export_csv(&path).unwrap(), 205);
        let records = csv::Reader::from_path(&path)
            .unwrap()
            .records()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(records.len(), 205);
        drop(tm);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn import_content_accepts_bom_and_optional_header() {
        let (tm, dir) = temp_tm();
        let csv = "\u{FEFF}source,target,source_lang,target_lang\nhello,你好,auto,Chinese\nworld,世界,auto,Chinese\n";
        assert_eq!(tm.import_csv_content(csv).unwrap(), 2);
        assert_eq!(
            tm.lookup("hello", "auto", "Chinese").as_deref(),
            Some("你好")
        );
        assert_eq!(
            tm.lookup("world", "auto", "Chinese").as_deref(),
            Some("世界")
        );
        drop(tm);
        let _ = std::fs::remove_dir_all(dir);
    }
}
