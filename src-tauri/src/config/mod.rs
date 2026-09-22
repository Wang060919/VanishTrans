//! Configuration ownership: durable settings, credential storage and request scopes.
mod context;
mod credentials;
mod load;
mod profiles;
mod requests;
mod storage;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{atomic::AtomicU64, Mutex};

/// Mutex protecting concurrent reads/writes to config.json.
pub static CONFIG_FILE_LOCK: Mutex<()> = Mutex::new(());

pub struct ApiConfig {
    pub base_url: Mutex<String>,
    pub api_key: Mutex<String>,
    pub model: Mutex<String>,
    pub client: Mutex<reqwest::Client>,
    config_path: std::path::PathBuf,
    write_lock: Mutex<()>,
    /// Monotonically increasing translation sequences, isolated by webview label.
    pub request_seq: Mutex<HashMap<String, u64>>,
    /// Independent cancellation domain for Alt+R replacement.
    pub replace_request_seq: AtomicU64,
    /// Hotkey bindings stored as (action, shortcut_string).
    /// Actions: "translate", "screenshot", "replace".
    pub hotkeys: Mutex<Vec<(String, String)>>,
    /// Custom glossary: Vec of (source, target) term pairs.
    pub glossary: Mutex<Vec<(String, String)>>,
    /// Maximum history records to keep.
    pub max_records: std::sync::atomic::AtomicUsize,
    /// Saved service profiles for quick switching between providers/models.
    pub profiles: Mutex<Vec<ServiceProfile>>,
    /// When enabled, translation uses the free Google Translate endpoint
    /// instead of the configured OpenAI-compatible API (no key required).
    pub free_translation: std::sync::atomic::AtomicBool,
}

#[derive(Serialize, Deserialize, Clone)]
struct PersistedConfig {
    base_url: String,
    model: String,
    #[serde(default)]
    hotkeys: Vec<(String, String)>,
    #[serde(default)]
    glossary: Vec<(String, String)>,
    #[serde(default = "default_max_records")]
    max_records: usize,
    #[serde(default)]
    profiles: Vec<ServiceProfile>,
    #[serde(default)]
    free_translation: bool,
}

#[derive(Clone)]
pub(crate) struct ConfigSnapshot {
    base_url: String,
    api_key: String,
    model: String,
    hotkeys: Vec<(String, String)>,
    glossary: Vec<(String, String)>,
    max_records: usize,
    profiles: Vec<ServiceProfile>,
    free_translation: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServiceProfile {
    pub name: String,
    pub base_url: String,
    pub model: String,
}

fn default_max_records() -> usize {
    200
}

#[cfg(test)]
mod request_tests;

#[cfg(test)]
mod storage_tests;
