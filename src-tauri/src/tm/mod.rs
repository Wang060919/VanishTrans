//! Translation memory backed by SQLite (`tm.db`).
//!
//! `TranslationMemory` holds a single connection behind a mutex and is split
//! across sibling modules by responsibility: `store` owns the connection
//! lifecycle and raw upserts, `query` the read paths and maintenance commands,
//! and `csv_io` versioned CSV export and chunked import. `tm_csv` keeps the
//! `vanishtrans-csv-v1`/`v2` row encoding so spreadsheet protection stays
//! reversible.

mod csv_io;
mod query;
mod store;
#[cfg(test)]
mod tests;
mod tm_csv;
#[cfg(test)]
mod tm_csv_tests;

pub use store::TranslationMemory;

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
