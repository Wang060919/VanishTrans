use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::lock::LockRecover;

const MAX_IMPORT_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 100_000;

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

impl TranslationMemory {
    /// Open or create the TM database in the given config directory.
    pub fn open(config_dir: &Path) -> Result<Self, String> {
        let db_path = config_dir.join("tm.db");
        let mut conn =
            Connection::open(&db_path).map_err(|e| format!("打开翻译记忆数据库失败: {}", e))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| format!("初始化翻译记忆数据库失败: {}", e))?;
        Self::initialize_schema(&mut conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Keep translation usable when the persistent database cannot be opened.
    /// Callers should surface a warning because entries will be lost on exit.
    pub fn open_in_memory() -> Result<Self, String> {
        let mut conn = Connection::open_in_memory()
            .map_err(|error| format!("创建临时翻译记忆失败: {error}"))?;
        conn.execute_batch("PRAGMA synchronous=NORMAL;")
            .map_err(|error| format!("初始化临时翻译记忆失败: {error}"))?;
        Self::initialize_schema(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn initialize_schema(conn: &mut Connection) -> Result<(), String> {
        let table_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'translation_memory')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("检查翻译记忆表失败: {error}"))?;

        if !table_exists {
            conn.execute_batch(
                "CREATE TABLE translation_memory (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 source TEXT NOT NULL,
                 target TEXT NOT NULL,
                 source_lang TEXT NOT NULL DEFAULT '',
                 target_lang TEXT NOT NULL DEFAULT '',
                 context_hash TEXT NOT NULL DEFAULT '',
                 created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                 hit_count INTEGER NOT NULL DEFAULT 0,
                 UNIQUE(source, source_lang, target_lang, context_hash)
             );
                 CREATE INDEX idx_tm_source ON translation_memory(source);",
            )
            .map_err(|error| format!("初始化翻译记忆表失败: {error}"))?;
            return Ok(());
        }

        let has_context_hash: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('translation_memory') WHERE name = 'context_hash')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("检查翻译记忆版本失败: {error}"))?;
        if has_context_hash {
            return Ok(());
        }

        let transaction = conn
            .transaction()
            .map_err(|error| format!("开始翻译记忆迁移失败: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE translation_memory_v2 (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     source TEXT NOT NULL,
                     target TEXT NOT NULL,
                     source_lang TEXT NOT NULL DEFAULT '',
                     target_lang TEXT NOT NULL DEFAULT '',
                     context_hash TEXT NOT NULL DEFAULT '',
                     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                     hit_count INTEGER NOT NULL DEFAULT 0,
                     UNIQUE(source, source_lang, target_lang, context_hash)
                 );
                 INSERT INTO translation_memory_v2
                     (id, source, target, source_lang, target_lang, context_hash, created_at, hit_count)
                 SELECT id, source, target, source_lang, target_lang, '', created_at, hit_count
                 FROM translation_memory;
                 DROP TABLE translation_memory;
                 ALTER TABLE translation_memory_v2 RENAME TO translation_memory;
                 CREATE INDEX idx_tm_source ON translation_memory(source);",
            )
            .map_err(|error| format!("迁移翻译记忆表失败: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("提交翻译记忆迁移失败: {error}"))
    }

    /// Internal store method — caller must already hold the lock.
    fn store_inner(
        conn: &Connection,
        source: &str,
        target: &str,
        source_lang: &str,
        target_lang: &str,
        context_hash: &str,
    ) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO translation_memory (source, target, source_lang, target_lang, context_hash)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(source, source_lang, target_lang, context_hash)
             DO UPDATE SET target = excluded.target",
            params![source, target, source_lang, target_lang, context_hash],
        )
    }

    /// Look up an exact match in the TM. Returns the translation if found.
    #[cfg(test)]
    pub fn lookup(&self, source: &str, source_lang: &str, target_lang: &str) -> Option<String> {
        self.lookup_in_context(source, source_lang, target_lang, "")
    }

    pub fn lookup_in_context(
        &self,
        source: &str,
        source_lang: &str,
        target_lang: &str,
        context_hash: &str,
    ) -> Option<String> {
        let conn = self.conn.lock_recover();
        let mut stmt = conn
            .prepare(
                "SELECT id, target FROM translation_memory
                 WHERE source = ?1 AND source_lang = ?2 AND target_lang = ?3 AND context_hash = ?4
                 LIMIT 1",
            )
            .ok()?;

        let mut rows = stmt
            .query(params![source, source_lang, target_lang, context_hash])
            .ok()?;
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
    #[cfg(test)]
    pub fn store(&self, source: &str, target: &str, source_lang: &str, target_lang: &str) {
        self.store_in_context(source, target, source_lang, target_lang, "");
    }

    pub fn store_in_context(
        &self,
        source: &str,
        target: &str,
        source_lang: &str,
        target_lang: &str,
        context_hash: &str,
    ) {
        let conn = self.conn.lock_recover();
        if let Err(e) = Self::store_inner(
            &conn,
            source,
            target,
            source_lang,
            target_lang,
            context_hash,
        ) {
            log::error!("[tm] Failed to store translation: {}", e);
        }
    }

    /// Search TM entries by source or target text.
    pub fn search(&self, query: &str) -> Vec<TmEntry> {
        let conn = self.conn.lock_recover();
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
    pub fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock_recover();
        conn.execute("DELETE FROM translation_memory WHERE id = ?1", params![id])
            .map_err(|e| format!("删除翻译记忆失败: {}", e))?;
        Ok(())
    }

    /// Clear all TM entries.
    pub fn clear(&self) -> Result<(), String> {
        let conn = self.conn.lock_recover();
        conn.execute("DELETE FROM translation_memory", [])
            .map_err(|e| format!("清空翻译记忆失败: {}", e))?;
        Ok(())
    }

    /// Get TM statistics.
    pub fn stats(&self) -> TmStats {
        let conn = self.conn.lock_recover();
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
                escape_spreadsheet_formula(&entry.source),
                escape_spreadsheet_formula(&entry.target),
                escape_spreadsheet_formula(&entry.source_lang),
                escape_spreadsheet_formula(&entry.target_lang),
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
        let conn = self.conn.lock_recover();
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
    #[cfg(test)]
    pub fn import_csv(&self, path: &Path) -> Result<usize, String> {
        self.import_csv_for_context(path, "")
    }

    pub fn import_csv_for_context(&self, path: &Path, context_hash: &str) -> Result<usize, String> {
        let size = std::fs::metadata(path)
            .map_err(|e| format!("读取 CSV 文件信息失败: {}", e))?
            .len() as usize;
        if size > MAX_IMPORT_BYTES {
            return Err(format!(
                "CSV 文件过大（{} MB），最大支持 {} MB",
                size / 1024 / 1024,
                MAX_IMPORT_BYTES / 1024 / 1024
            ));
        }
        let file = std::fs::File::open(path).map_err(|e| format!("读取 CSV 文件失败: {}", e))?;
        self.import_csv_reader(file, context_hash)
    }

    #[cfg(test)]
    pub fn import_csv_content(&self, content: &str) -> Result<usize, String> {
        self.import_csv_content_for_context(content, "")
    }

    pub fn import_csv_content_for_context(
        &self,
        content: &str,
        context_hash: &str,
    ) -> Result<usize, String> {
        if content.len() > MAX_IMPORT_BYTES {
            return Err(format!(
                "CSV 内容过大（{} MB），最大支持 {} MB",
                content.len() / 1024 / 1024,
                MAX_IMPORT_BYTES / 1024 / 1024
            ));
        }
        self.import_csv_reader(content.as_bytes(), context_hash)
    }

    fn import_csv_reader<R: std::io::Read>(
        &self,
        reader: R,
        context_hash: &str,
    ) -> Result<usize, String> {
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(reader);

        let mut conn = self.conn.lock_recover();
        let transaction = conn
            .transaction()
            .map_err(|error| format!("开始导入翻译记忆失败: {error}"))?;
        let mut count = 0;
        for (index, result) in rdr.records().enumerate() {
            if index >= MAX_IMPORT_ROWS {
                return Err(format!("CSV 行数过多，最多支持 {MAX_IMPORT_ROWS} 行"));
            }
            let record = result.map_err(|e| format!("解析 CSV 行失败: {}", e))?;
            if record.len() >= 2 {
                let source = unescape_spreadsheet_formula(record[0].trim_start_matches('\u{FEFF}'));
                let target = unescape_spreadsheet_formula(&record[1]);
                if index == 0
                    && source.eq_ignore_ascii_case("source")
                    && target.eq_ignore_ascii_case("target")
                {
                    continue;
                }
                if source.is_empty() {
                    continue;
                }
                let source_lang = unescape_spreadsheet_formula(record.get(2).unwrap_or(""));
                let target_lang = unescape_spreadsheet_formula(record.get(3).unwrap_or(""));
                Self::store_inner(
                    &transaction,
                    &source,
                    &target,
                    &source_lang,
                    &target_lang,
                    context_hash,
                )
                .map_err(|e| format!("导入翻译记忆失败: {}", e))?;
                count += 1;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("提交翻译记忆导入失败: {error}"))?;
        Ok(count)
    }
}

fn escape_spreadsheet_formula(value: &str) -> String {
    if value
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '=' | '+' | '-' | '@' | '\t' | '\r'))
    {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

fn unescape_spreadsheet_formula(value: &str) -> String {
    let Some(rest) = value.strip_prefix('\'') else {
        return value.to_string();
    };
    if rest
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '=' | '+' | '-' | '@' | '\t' | '\r'))
    {
        rest.to_string()
    } else {
        value.to_string()
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

    #[test]
    fn cache_entries_are_scoped_to_the_translation_context() {
        let (tm, dir) = temp_tm();
        tm.store_in_context("hello", "你好", "auto", "Chinese", "provider-a");

        assert_eq!(
            tm.lookup_in_context("hello", "auto", "Chinese", "provider-a")
                .as_deref(),
            Some("你好")
        );
        assert_eq!(
            tm.lookup_in_context("hello", "auto", "Chinese", "provider-b"),
            None
        );

        drop(tm);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn csv_export_neutralizes_formulas_and_import_restores_text() {
        let (tm, dir) = temp_tm();
        tm.store("=cmd|' /C calc'!A0", "+translated", "auto", "Chinese");
        let path = dir.join("safe-export.csv");
        tm.export_csv(&path).unwrap();

        let exported = std::fs::read_to_string(&path).unwrap();
        assert!(exported.contains("'=cmd"));
        assert!(exported.contains("'+translated"));

        tm.clear().unwrap();
        tm.import_csv(&path).unwrap();
        assert_eq!(
            tm.lookup("=cmd|' /C calc'!A0", "auto", "Chinese")
                .as_deref(),
            Some("+translated")
        );

        drop(tm);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn opening_an_legacy_database_migrates_it_without_losing_entries() {
        let (_, dir) = temp_tm();
        let db_path = dir.join("tm.db");
        let _ = std::fs::remove_file(&db_path);
        let connection = Connection::open(&db_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE translation_memory (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     source TEXT NOT NULL,
                     target TEXT NOT NULL,
                     source_lang TEXT NOT NULL DEFAULT '',
                     target_lang TEXT NOT NULL DEFAULT '',
                     created_at INTEGER NOT NULL DEFAULT 0,
                     hit_count INTEGER NOT NULL DEFAULT 0,
                     UNIQUE(source, source_lang, target_lang)
                 );
                 INSERT INTO translation_memory
                     (source, target, source_lang, target_lang)
                 VALUES ('legacy', '旧数据', 'auto', 'Chinese');",
            )
            .unwrap();
        drop(connection);

        let tm = TranslationMemory::open(&dir).unwrap();
        assert_eq!(
            tm.lookup("legacy", "auto", "Chinese").as_deref(),
            Some("旧数据")
        );
        tm.store_in_context("legacy", "新数据", "auto", "Chinese", "new-context");
        assert_eq!(
            tm.lookup_in_context("legacy", "auto", "Chinese", "new-context")
                .as_deref(),
            Some("新数据")
        );

        drop(tm);
        let _ = std::fs::remove_dir_all(dir);
    }
}
