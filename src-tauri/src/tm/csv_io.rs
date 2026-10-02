//! CSV exchange. Exports write `vanishtrans-csv-v2` rows (see `tm_csv` for the
//! row encoding); imports accept v2, legacy v1 and unmarked files, and commit
//! one transaction per `IMPORT_CHUNK_ROWS` so `conn` is released between
//! chunks and a large import never stalls translations or cancellation for
//! the whole file.

use std::path::Path;

use crate::lock::LockRecover;

use super::store::TranslationMemory;
use super::tm_csv::{self, escape_spreadsheet_formula};

const MAX_IMPORT_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 100_000;
/// Import commits per chunk so `conn` is released between chunks and a large
/// import never stalls translations or cancellation for the whole file.
/// `pub(super)` so tests can build rows that cross a chunk boundary.
pub(super) const IMPORT_CHUNK_ROWS: usize = 500;

/// Internal export projection; the wire `TmEntry` shape stays unchanged.
struct ExportRow {
    source: String,
    target: String,
    source_lang: String,
    target_lang: String,
    context_hash: String,
    created_at: i64,
    hit_count: i64,
}

impl TranslationMemory {
    /// Export TM to CSV in `vanishtrans-csv-v2` form (with UTF-8 BOM for Excel
    /// compatibility): each row carries context hash, creation time and hit
    /// count so a re-import restores contexts and never regresses freshness.
    pub fn export_csv(&self, path: &Path) -> Result<usize, String> {
        let rows = self.export_rows()?;
        let count = rows.len();
        let mut content = String::from("\u{FEFF}");
        let mut wtr = csv::Writer::from_writer(Vec::new());
        wtr.write_record(tm_csv::HEADER_V2)
            .map_err(|e| format!("写入 CSV 表头失败: {}", e))?;
        for row in &rows {
            wtr.serialize((
                escape_spreadsheet_formula(&row.source),
                escape_spreadsheet_formula(&row.target),
                escape_spreadsheet_formula(&row.source_lang),
                escape_spreadsheet_formula(&row.target_lang),
                escape_spreadsheet_formula(&row.context_hash),
                row.created_at,
                row.hit_count,
                tm_csv::ENCODING_V2,
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

    fn export_rows(&self) -> Result<Vec<ExportRow>, String> {
        let conn = self.conn.lock_recover();
        let mut stmt = conn
            .prepare(
                "SELECT source, target, source_lang, target_lang, context_hash, created_at, hit_count
                 FROM translation_memory ORDER BY created_at DESC, id DESC",
            )
            .map_err(|e| format!("读取翻译记忆失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ExportRow {
                    source: row.get(0)?,
                    target: row.get(1)?,
                    source_lang: row.get(2)?,
                    target_lang: row.get(3)?,
                    context_hash: row.get(4)?,
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
        // The frontend decodes pasted content lossily; replacement characters
        // mean the bytes were not valid UTF-8 (e.g. a GBK Excel export), so
        // refuse instead of committing mojibake.
        if content.contains('\u{FFFD}') {
            return Err("文件不是有效的 UTF-8 编码，请另存为 UTF-8 CSV 后重试".to_string());
        }
        self.import_csv_reader(content.as_bytes(), context_hash)
    }

    /// Import commits one transaction per `IMPORT_CHUNK_ROWS` rows, releasing
    /// `conn` between chunks so translations keep running during large
    /// imports. A mid-file failure therefore returns an error with the already
    /// committed prefix kept (partial import).
    fn import_csv_reader<R: std::io::Read>(
        &self,
        reader: R,
        context_hash: &str,
    ) -> Result<usize, String> {
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(reader);

        let mut total = 0usize;
        let mut saw_record = false;
        let mut chunk: Vec<(usize, csv::StringRecord)> = Vec::with_capacity(IMPORT_CHUNK_ROWS);
        for (index, result) in rdr.records().enumerate() {
            if index >= MAX_IMPORT_ROWS {
                return Err(partial_note(
                    format!("CSV 行数过多，最多支持 {MAX_IMPORT_ROWS} 行"),
                    total,
                ));
            }
            let record = result.map_err(|e| partial_note(map_csv_error(e), total))?;
            saw_record = true;
            chunk.push((index, record));
            if chunk.len() >= IMPORT_CHUNK_ROWS {
                total += self
                    .flush_import_chunk(&mut chunk, context_hash)
                    .map_err(|error| partial_note(error, total))?;
            }
        }
        if !chunk.is_empty() {
            total += self
                .flush_import_chunk(&mut chunk, context_hash)
                .map_err(|error| partial_note(error, total))?;
        }
        if saw_record && total == 0 {
            // Never report "imported 0" for a non-empty file — it would look
            // like success while nothing usable was parsed.
            return Err("没有可导入的数据行（仅检测到表头或不完整的行）".to_string());
        }
        Ok(total)
    }

    fn flush_import_chunk(
        &self,
        chunk: &mut Vec<(usize, csv::StringRecord)>,
        context_hash: &str,
    ) -> Result<usize, String> {
        let mut conn = self.conn.lock_recover();
        let transaction = conn
            .transaction()
            .map_err(|error| format!("开始导入翻译记忆失败: {error}"))?;
        let mut count = 0;
        for (index, record) in chunk.drain(..) {
            if let Some(decoded) = tm_csv::decode_record(&record, index) {
                Self::store_import_inner(
                    &transaction,
                    &decoded.fields,
                    decoded.meta.as_ref(),
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

/// Explain lossy-decoded bytes with a fixable message instead of committing
/// mojibake or reporting a raw parser failure.
fn map_csv_error(error: csv::Error) -> String {
    match error.kind() {
        csv::ErrorKind::Utf8 { .. } => {
            "文件不是有效的 UTF-8 编码，请另存为 UTF-8 CSV 后重试".to_string()
        }
        _ => format!("解析 CSV 行失败: {error}"),
    }
}

/// Imports commit per chunk, so a failure after the first chunk leaves a
/// committed prefix; say so instead of implying an all-or-nothing rollback.
fn partial_note(message: String, committed: usize) -> String {
    if committed > 0 {
        format!("{message}（已提交前 {committed} 条，导入未完成）")
    } else {
        message
    }
}
