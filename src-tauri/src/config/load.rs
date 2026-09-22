use super::{
    credentials::load_api_key_credential, default_max_records, ApiConfig, PersistedConfig,
};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Mutex},
    time::Duration,
};

impl ApiConfig {
    pub fn load_or_default(config_dir: std::path::PathBuf) -> Self {
        let config_path = config_dir.join("config.json");
        let (
            base_url,
            model,
            hotkeys,
            glossary,
            max_records,
            profiles,
            free_translation,
            config_existed,
        ) = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|d| serde_json::from_str::<PersistedConfig>(&d).ok())
            .map(|c| {
                (
                    c.base_url,
                    c.model,
                    c.hotkeys,
                    c.glossary,
                    c.max_records.clamp(50, 1000),
                    c.profiles,
                    c.free_translation,
                    true,
                )
            })
            .unwrap_or_else(|| {
                let (b, _, m) = Self::defaults();
                (
                    b,
                    m,
                    Self::default_hotkeys(),
                    Vec::new(),
                    default_max_records(),
                    Vec::new(),
                    false,
                    false,
                )
            });
        let api_key = load_api_key_credential().unwrap_or_default();
        let client = reqwest::Client::builder()
            // Non-streaming requests apply their own total timeout below.
            // Streaming requests use a per-chunk idle timeout so active streams
            // are not cut off after a fixed wall-clock duration.
            .timeout(Duration::from_secs(24 * 60 * 60))
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(4)
            .tcp_keepalive(Duration::from_secs(60))
            .build()
            .unwrap_or_default();
        let this = Self {
            base_url: Mutex::new(base_url),
            api_key: Mutex::new(api_key),
            model: Mutex::new(model),
            client: Mutex::new(client),
            config_path,
            write_lock: Mutex::new(()),
            request_seq: Mutex::new(HashMap::new()),
            replace_request_seq: AtomicU64::new(0),
            hotkeys: Mutex::new(if hotkeys.is_empty() {
                Self::default_hotkeys()
            } else {
                hotkeys
            }),
            glossary: Mutex::new(glossary),
            max_records: std::sync::atomic::AtomicUsize::new(max_records),
            profiles: Mutex::new(profiles),
            free_translation: std::sync::atomic::AtomicBool::new(free_translation),
        };
        // Only persist when the file didn't exist — avoid a sync write on every cold start
        if !config_existed {
            if let Err(e) = this.save_to_disk() {
                log::error!("[config] Failed to create default config: {}", e);
            }
        }
        this
    }

    pub fn defaults() -> (String, String, String) {
        (
            "https://api.openai.com".into(),
            String::new(),
            "gpt-4o-mini".into(),
        )
    }
    pub fn default_hotkeys() -> Vec<(String, String)> {
        vec![
            ("translate".into(), "Alt+Q".into()),
            ("replace".into(), "Alt+R".into()),
            ("screenshot".into(), "Alt+W".into()),
        ]
    }
}
