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

impl ApiConfig {
    /// Stable cache partition for provider, model and glossary settings.
    pub fn translation_context_hash(&self) -> String {
        let canonical = serde_json::json!({
            "v": 2,
            "baseUrl": *self.base_url.lock_recover(),
            "model": *self.model.lock_recover(),
            "glossary": *self.glossary.lock_recover(),
            "freeTranslation": self.free_translation(),
        });
        let bytes = serde_json::to_vec(&canonical).unwrap_or_default();
        format!("{:016x}", fnv1a64(&bytes))
    }
}
