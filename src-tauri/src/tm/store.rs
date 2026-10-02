//! `TranslationMemory` owns the SQLite connection and its file lifecycle:
//! opening (persistent or transient in-memory), schema migration, `VACUUM
//! INTO` copies and live repointing after `set_tm_dir`. The raw row upserts
//! shared by normal stores and CSV imports also live here so the conflict
//! rules stay next to the table definition.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::lock::LockRecover;

use super::tm_csv;

pub struct TranslationMemory {
    /// Shared by every submodule and inspected directly by tests.
    pub(super) conn: Mutex<Connection>,
    /// Backing file; `None` in transient in-memory mode.
    db_path: Mutex<Option<std::path::PathBuf>>,
}

impl TranslationMemory {
    fn connect(db_path: &Path) -> Result<Connection, String> {
        let mut conn =
            Connection::open(db_path).map_err(|e| format!("打开翻译记忆数据库失败: {}", e))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=3000;",
        )
        .map_err(|e| format!("初始化翻译记忆数据库失败: {}", e))?;
        Self::initialize_schema(&mut conn)?;
        Ok(conn)
    }

    /// Open or create the TM database in the given config directory.
    pub fn open(config_dir: &Path) -> Result<Self, String> {
        let db_path = config_dir.join("tm.db");
        let conn = Self::connect(&db_path)?;
        Ok(Self {
            conn: Mutex::new(conn),
            db_path: Mutex::new(Some(db_path)),
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
            db_path: Mutex::new(None),
        })
    }

    /// Path of the backing `tm.db`; `None` in transient in-memory mode.
    #[cfg(test)]
    pub fn db_path(&self) -> Option<std::path::PathBuf> {
        self.db_path.lock_recover().clone()
    }

    /// Copy the live `tm.db` into `dest_dir` via `VACUUM INTO`, which produces
    /// a consistent standalone copy in one statement and refuses an existing
    /// destination. Lock order: `db_path` before `conn` — same as `reopen`,
    /// so concurrent set_tm_dir calls cannot deadlock.
    pub fn copy_db_to(&self, dest_dir: &Path) -> Result<(), String> {
        let source = self
            .db_path
            .lock_recover()
            .clone()
            .ok_or_else(|| "翻译记忆为临时内存模式，没有可迁移的数据".to_string())?;
        let dest = dest_dir.join("tm.db");
        if same_db_file(&dest, &source) {
            return Ok(());
        }
        if dest.exists() {
            return Err(format!("目标目录已存在 tm.db：{}", dest.display()));
        }
        let conn = self.conn.lock_recover();
        // A WAL checkpoint could report "busy" in its result row while
        // execute_batch treats that as success, so byte-copying risks a
        // torn snapshot; VACUUM INTO never copies a partial database.
        conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy().as_ref()])
            .map_err(|e| format!("复制翻译记忆数据库失败: {e}"))?;
        Ok(())
    }

    /// Point the live connection at `dest_dir/tm.db` after the directory
    /// setting changed, so subsequent translations never keep writing the old
    /// file. Opens the new connection before swapping: on failure the current
    /// connection stays in place.
    pub fn reopen(&self, dest_dir: &Path) -> Result<(), String> {
        let target = dest_dir.join("tm.db");
        {
            let current = self.db_path.lock_recover();
            if current
                .as_ref()
                .is_some_and(|path| same_db_file(&target, path))
            {
                return Ok(());
            }
        }
        let conn = Self::connect(&target)?;
        *self.conn.lock_recover() = conn;
        *self.db_path.lock_recover() = Some(target);
        Ok(())
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

    /// Internal store method — caller must already hold the lock. A conflict
    /// refreshes `created_at` so freshness comparisons (v2 imports) see the
    /// last write as the newest row; `hit_count` is preserved.
    pub(super) fn store_inner(
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
             DO UPDATE SET target = excluded.target, created_at = excluded.created_at",
            params![source, target, source_lang, target_lang, context_hash],
        )
    }

    /// Import one row — caller must already hold the lock. Rows carrying v2
    /// metadata restore their own context hash and only overwrite a same-key
    /// row when the incoming `created_at` is not older, so re-importing an
    /// export never regresses freshness. Unmarked rows keep the caller's
    /// context and the historical file-order upsert.
    pub(super) fn store_import_inner(
        conn: &Connection,
        fields: &[String; 4],
        meta: Option<&tm_csv::RowMeta>,
        fallback_context: &str,
    ) -> rusqlite::Result<usize> {
        let (source, target, source_lang, target_lang) =
            (&fields[0], &fields[1], &fields[2], &fields[3]);
        match meta {
            Some(meta) => conn.execute(
                "INSERT INTO translation_memory
                     (source, target, source_lang, target_lang, context_hash, created_at, hit_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(source, source_lang, target_lang, context_hash)
                 DO UPDATE SET target = excluded.target,
                               created_at = excluded.created_at,
                               hit_count = excluded.hit_count
                 WHERE excluded.created_at >= translation_memory.created_at",
                params![
                    source,
                    target,
                    source_lang,
                    target_lang,
                    meta.context_hash,
                    meta.created_at,
                    meta.hit_count
                ],
            ),
            None => Self::store_inner(
                conn,
                source,
                target,
                source_lang,
                target_lang,
                fallback_context,
            ),
        }
    }
}

/// Whether `dest` and `source` resolve to the same database file.
fn same_db_file(dest: &Path, source: &Path) -> bool {
    std::fs::canonicalize(dest)
        .ok()
        .zip(std::fs::canonicalize(source).ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false)
}
