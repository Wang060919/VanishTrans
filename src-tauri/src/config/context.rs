use super::ApiConfig;
use crate::lock::LockRecover;

/// FNV-1a 64-bit hash — deterministic and stable across Rust toolchains,
/// unlike `std::hash::DefaultHasher` whose algorithm is unspecified.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Immutable settings shared by request routing, prompts and the TM partition.
#[derive(Clone)]
pub struct TranslationConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub glossary: Vec<(String, String)>,
    pub free_translation: bool,
}

impl ApiConfig {
    pub fn translation_snapshot(&self) -> TranslationConfig {
        let _write_guard = self.lock_for_write();
        TranslationConfig {
            base_url: self.base_url.lock_recover().clone(),
            api_key: self.api_key.lock_recover().clone(),
            model: self.model.lock_recover().clone(),
            glossary: self.glossary.lock_recover().clone(),
            free_translation: self.free_translation(),
        }
    }

    pub fn translation_context_hash(&self) -> String {
        self.translation_snapshot().context_hash()
    }
}

impl TranslationConfig {
    /// Stable cache partition; credentials never enter the persisted fingerprint.
    pub fn context_hash(&self) -> String {
        let canonical = serde_json::json!({
            "v": 2,
            "baseUrl": self.base_url,
            "model": self.model,
            "glossary": self.glossary,
            "freeTranslation": self.free_translation,
        });
        let bytes = serde_json::to_vec(&canonical).unwrap_or_default();
        format!("{:016x}", fnv1a64(&bytes))
    }
}
