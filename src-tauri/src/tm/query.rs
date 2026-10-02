//! Read paths and row maintenance: context-scoped lookup and store (the hot
//! path for translations), LIKE search for the TM panel, and delete/clear/
//! stats. Write errors surface as `Err`; read errors log and degrade to a
//! miss or empty results so a broken table never blocks translation.

use rusqlite::params;

use crate::lock::LockRecover;

use super::store::TranslationMemory;
use super::{TmEntry, TmStats};

impl TranslationMemory {
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
            .map_err(|error| {
                log::error!("[tm] lookup prepare failed: {error}");
            })
            .ok()?;

        let mut rows = stmt
            .query(params![source, source_lang, target_lang, context_hash])
            .map_err(|error| {
                log::error!("[tm] lookup query failed: {error}");
            })
            .ok()?;
        let row = match rows.next() {
            Ok(row) => row,
            Err(error) => {
                log::error!("[tm] lookup row read failed: {error}");
                None
            }
        };
        if let Some(row) = row {
            let id: i64 = row.get(0).ok()?;
            let target: String = row.get(1).ok()?;
            // Older versions could cache empty completions; retry instead of replaying them.
            if target.trim().is_empty() {
                return None;
            }
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
        self.store_in_context(source, target, source_lang, target_lang, "")
            .expect("test TM write should succeed");
    }

    pub fn store_in_context(
        &self,
        source: &str,
        target: &str,
        source_lang: &str,
        target_lang: &str,
        context_hash: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock_recover();
        Self::store_inner(
            &conn,
            source,
            target,
            source_lang,
            target_lang,
            context_hash,
        )
        .map_err(|error| {
            log::error!("[tm] Failed to store translation: {}", error);
            format!("写入翻译记忆失败: {}", error)
        })
        .map(|_| ())
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
             WHERE source LIKE ?1 ESCAPE '!' OR target LIKE ?1 ESCAPE '!'
             ORDER BY hit_count DESC, created_at DESC LIMIT 200"
        };

        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(error) => {
                log::error!("[tm] search prepare failed: {error}");
                return Vec::new();
            }
        };

        let pattern = if query.is_empty() {
            String::new()
        } else {
            format!("%{}%", escape_like_pattern(query))
        };

        let rows = if query.is_empty() {
            stmt.query([])
        } else {
            stmt.query(params![pattern])
        };

        let mut entries = Vec::new();
        match rows {
            Ok(mut rows) => loop {
                match rows.next() {
                    Ok(Some(row)) => entries.push(TmEntry {
                        id: row.get(0).unwrap_or(0),
                        source: row.get(1).unwrap_or_default(),
                        target: row.get(2).unwrap_or_default(),
                        source_lang: row.get(3).unwrap_or_default(),
                        target_lang: row.get(4).unwrap_or_default(),
                        created_at: row.get(5).unwrap_or(0),
                        hit_count: row.get(6).unwrap_or(0),
                    }),
                    Ok(None) => break,
                    Err(error) => {
                        log::error!(
                            "[tm] search row read failed; returning partial results: {error}"
                        );
                        break;
                    }
                }
            },
            Err(error) => {
                log::error!("[tm] search query failed: {error}");
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
            .unwrap_or_else(|error| {
                log::error!("[tm] stats count failed: {error}");
                0
            });
        let total_hits: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(hit_count), 0) FROM translation_memory",
                [],
                |r| r.get(0),
            )
            .unwrap_or_else(|error| {
                log::error!("[tm] stats hit count failed: {error}");
                0
            });
        TmStats {
            total_entries,
            total_hits,
        }
    }
}

fn escape_like_pattern(query: &str) -> String {
    query
        .replace('!', "!!")
        .replace('%', "!%")
        .replace('_', "!_")
}
