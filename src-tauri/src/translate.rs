use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::lock::LockRecover;

/// Mutex protecting concurrent reads/writes to config.json.
pub static CONFIG_FILE_LOCK: Mutex<()> = Mutex::new(());

pub const BASE_SYSTEM_PROMPT: &str = r#"You are a professional translation engine. Your ONLY task is to translate the user's input text.

RULES (violating any will be considered a failure):
1. Output ONLY the translated text. Nothing else.
2. NO explanations, NO notes, NO pinyin, NO romanization, NO greetings, NO disclaimers.
3. If the input is already in the target language, output it unchanged.
4. Preserve the original formatting: line breaks, whitespace style, and punctuation conventions of the source.
5. For code snippets or technical terms in the input, keep them exactly as-is — only translate natural language parts.
6. If the input is ambiguous, pick the most natural reading and translate it. Do NOT ask questions.
7. NEVER prefix with "Translation:", "Here is:", or similar meta-text.
8. NEVER wrap the output in quotes unless the original was quoted.
9. For Chinese output, use simplified Chinese (简体中文).
10. Translate naturally — the result should read as if originally written in the target language."#;

/// Build the system prompt, optionally appending glossary terms.
pub fn build_system_prompt(glossary: &[(String, String)]) -> String {
    if glossary.is_empty() {
        return BASE_SYSTEM_PROMPT.to_string();
    }
    let mut prompt = String::from(BASE_SYSTEM_PROMPT);
    prompt.push_str("\n\nGLOSSARY (use these exact translations when the source term appears):\n");
    for (source, target) in glossary {
        prompt.push_str(&format!("- \"{}\" → \"{}\"\n", source, target));
    }
    prompt
}

/// Maximum input characters accepted by the translate command.
const MAX_INPUT_CHARS: usize = 10_000;

/// Maximum response body size in bytes (1 MB).
const MAX_RESPONSE_BYTES: usize = 1_024 * 1_024;

/// Request timeout in seconds.
const TIMEOUT_SECS: u64 = 30;

async fn read_response_body_limited(response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取响应失败: {}", e))?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(format!(
                "API 响应体过大（超过 {} KB）",
                MAX_RESPONSE_BYTES / 1024
            ));
        }
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Deserialize)]
struct ChatMessageResponse {
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

// -----------------------------------------------------------
// Windows Credential Manager helpers
// -----------------------------------------------------------

const CRED_TARGET: &str = "VanishTrans_APIKey";

#[cfg(target_os = "windows")]
fn save_api_key_credential(key: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    if key.is_empty() {
        unsafe {
            let _ = CredDeleteW(&HSTRING::from(CRED_TARGET), CRED_TYPE_GENERIC, 0);
        }
        return Ok(());
    }

    let target = HSTRING::from(CRED_TARGET);
    let username = HSTRING::from("VanishTrans");
    let secret_bytes: &[u8] = key.as_bytes();
    let secret_len = secret_bytes.len() as u32;

    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: windows::core::PWSTR::from_raw(target.as_ptr() as *mut _),
        Comment: windows::core::PWSTR::null(),
        LastWritten: Default::default(),
        CredentialBlobSize: secret_len,
        CredentialBlob: secret_bytes.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: windows::core::PWSTR::null(),
        UserName: windows::core::PWSTR::from_raw(username.as_ptr() as *mut _),
    };

    unsafe {
        CredWriteW(&cred, 0).map_err(|e| format!("存储凭据失败: {}", e))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn load_api_key_credential() -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        if CredReadW(
            &HSTRING::from(CRED_TARGET),
            CRED_TYPE_GENERIC,
            0,
            &mut pcred,
        )
        .is_err()
        {
            return None;
        }
        if pcred.is_null() {
            return None;
        }
        let blob_size = (*pcred).CredentialBlobSize as usize;
        let blob_ptr = (*pcred).CredentialBlob;
        if blob_ptr.is_null() || blob_size == 0 {
            CredFree(pcred as *const _);
            return None;
        }
        let bytes = std::slice::from_raw_parts(blob_ptr, blob_size);
        let key = String::from_utf8_lossy(bytes).to_string();
        CredFree(pcred as *const _);
        if key.is_empty() {
            None
        } else {
            Some(key)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn save_api_key_credential(_key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn load_api_key_credential() -> Option<String> {
    None
}

// -----------------------------------------------------------
// API Config
// -----------------------------------------------------------

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

    pub(crate) fn lock_for_write(&self) -> std::sync::MutexGuard<'_, ()> {
        self.write_lock.lock_recover()
    }

    pub(crate) fn snapshot(&self) -> ConfigSnapshot {
        ConfigSnapshot {
            base_url: self.base_url.lock_recover().clone(),
            api_key: self.api_key.lock_recover().clone(),
            model: self.model.lock_recover().clone(),
            hotkeys: self.hotkeys.lock_recover().clone(),
            glossary: self.glossary.lock_recover().clone(),
            max_records: self.max_records.load(Ordering::Relaxed),
            profiles: self.profiles.lock_recover().clone(),
            free_translation: self.free_translation(),
        }
    }

    pub(crate) fn restore(&self, snapshot: &ConfigSnapshot) {
        *self.base_url.lock_recover() = snapshot.base_url.clone();
        *self.api_key.lock_recover() = snapshot.api_key.clone();
        *self.model.lock_recover() = snapshot.model.clone();
        *self.hotkeys.lock_recover() = snapshot.hotkeys.clone();
        *self.glossary.lock_recover() = snapshot.glossary.clone();
        self.max_records
            .store(snapshot.max_records, Ordering::Relaxed);
        *self.profiles.lock_recover() = snapshot.profiles.clone();
        self.free_translation
            .store(snapshot.free_translation, Ordering::Relaxed);
    }

    pub fn default_hotkeys() -> Vec<(String, String)> {
        vec![
            ("translate".into(), "Alt+Q".into()),
            ("replace".into(), "Alt+R".into()),
            ("screenshot".into(), "Alt+W".into()),
        ]
    }

    pub fn save_to_disk(&self) -> Result<(), String> {
        let _lock = CONFIG_FILE_LOCK.lock_recover();
        let cfg = PersistedConfig {
            base_url: self.base_url.lock_recover().clone(),
            model: self.model.lock_recover().clone(),
            hotkeys: self.hotkeys.lock_recover().clone(),
            glossary: self.glossary.lock_recover().clone(),
            max_records: self.max_records.load(std::sync::atomic::Ordering::Relaxed),
            profiles: self.profiles.lock_recover().clone(),
            free_translation: self.free_translation(),
        };
        if let Some(p) = self.config_path.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("创建配置目录失败: {}", e))?;
        }
        let tmp_path = self.config_path.with_extension("json.tmp");
        let mut value = match serde_json::to_value(&cfg) {
            Ok(value) => value,
            Err(e) => {
                return Err(format!("序列化配置失败: {}", e));
            }
        };
        if let Ok(existing) = std::fs::read_to_string(&self.config_path) {
            if let Ok(serde_json::Value::Object(mut existing)) =
                serde_json::from_str::<serde_json::Value>(&existing)
            {
                if let serde_json::Value::Object(updated) = &value {
                    existing.extend(updated.clone());
                    value = serde_json::Value::Object(existing);
                }
            }
        }
        let json =
            serde_json::to_string_pretty(&value).map_err(|e| format!("序列化配置失败: {}", e))?;
        std::fs::write(&tmp_path, json).map_err(|e| format!("写入临时配置失败: {}", e))?;
        if let Err(e) = std::fs::rename(&tmp_path, &self.config_path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!("替换配置文件失败: {}", e));
        }
        Ok(())
    }

    pub fn save_api_key(&self) -> Result<(), String> {
        let key = self.api_key.lock_recover().clone();
        save_api_key_credential(&key)
    }

    /// Whether the free Google Translate provider is active.
    pub fn free_translation(&self) -> bool {
        self.free_translation
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Toggle the free Google Translate provider and persist the change.
    pub fn set_free_translation(&self, enabled: bool) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        self.free_translation.store(enabled, Ordering::Relaxed);
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }

    /// Claim a request sequence within one webview scope.
    pub fn next_request_seq(&self, scope: &str) -> u64 {
        let mut sequences = self.request_seq.lock_recover();
        let sequence = sequences.entry(scope.to_string()).or_insert(0);
        *sequence += 1;
        *sequence
    }

    /// Invalidate only the current request in one webview scope.
    pub fn cancel_current_request(&self, scope: &str) {
        self.next_request_seq(scope);
    }

    /// Returns true if `seq` is still the latest request in `scope`.
    pub fn is_current_request(&self, scope: &str, seq: u64) -> bool {
        self.request_seq.lock_recover().get(scope).copied() == Some(seq)
    }

    /// Run a side effect only while this request is still current.
    /// Sequence claims wait for the same lock, so the check and commit are atomic.
    pub(crate) fn with_current_request<T>(
        &self,
        scope: &str,
        seq: u64,
        commit: impl FnOnce() -> T,
    ) -> Option<T> {
        let sequences = self.request_seq.lock_recover();
        if sequences.get(scope).copied() != Some(seq) {
            return None;
        }
        Some(commit())
    }

    /// Claim a new Alt+R replacement sequence number.
    pub fn next_replace_request_seq(&self) -> u64 {
        self.replace_request_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Returns true if `seq` is still the latest Alt+R replacement request.
    pub fn is_current_replace_request(&self, seq: u64) -> bool {
        self.replace_request_seq.load(Ordering::SeqCst) == seq
    }

    pub fn upsert_profile(&self, profile: ServiceProfile) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let mut profiles = self.profiles.lock_recover();
        if let Some(existing) = profiles
            .iter_mut()
            .find(|existing| existing.name == profile.name)
        {
            *existing = profile;
        } else {
            profiles.push(profile);
        }
        drop(profiles);
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }

    pub fn delete_profile(&self, name: &str) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let mut profiles = self.profiles.lock_recover();
        profiles.retain(|profile| profile.name != name);
        drop(profiles);
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }

    /// Apply a saved profile's base URL and model to the active configuration.
    pub fn apply_profile(&self, name: &str) -> Result<(), String> {
        let _write_guard = self.lock_for_write();
        let snapshot = self.snapshot();
        let profile = self
            .profiles
            .lock_recover()
            .iter()
            .find(|profile| profile.name == name)
            .cloned()
            .ok_or_else(|| format!("找不到服务档案: {}", name))?;
        *self.base_url.lock_recover() = profile.base_url;
        *self.model.lock_recover() = profile.model;
        if let Err(error) = self.save_to_disk() {
            self.restore(&snapshot);
            return Err(error);
        }
        Ok(())
    }

    /// Fingerprint every setting that can change a translation result.
    /// TM entries are scoped to this value so changing provider, model, or
    /// glossary cannot silently return a result produced by stale settings.
    ///
    /// Hashes a canonical JSON encoding with FNV-1a. This is stable across
    /// Rust toolchains, so an app upgrade does not silently orphan the whole
    /// translation-memory cache (the previous `DefaultHasher` had no such
    /// guarantee).
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

// -----------------------------------------------------------
// Language detection
// -----------------------------------------------------------

fn cjk_ratio(text: &str) -> f64 {
    if text.is_empty() {
        return 0.0;
    }
    let cjk = text
        .chars()
        .filter(|&c| {
            let cp = c as u32;
            (0x4E00..=0x9FFF).contains(&cp)
                || (0x3400..=0x4DBF).contains(&cp)
                || (0x20000..=0x2A6DF).contains(&cp)
                || (0x2A700..=0x2B73F).contains(&cp)
                || (0x2B740..=0x2B81F).contains(&cp)
                || (0x2B820..=0x2CEAF).contains(&cp)
                || (0xF900..=0xFAFF).contains(&cp)
                || (0xFE30..=0xFE4F).contains(&cp)
        })
        .count();
    cjk as f64 / text.chars().count() as f64
}

pub fn resolve_target_lang(text: &str, direction: &str) -> &'static str {
    match direction {
        "auto2zh" | "en2zh" => "Chinese",
        "auto2en" | "zh2en" => "English",
        "auto" if cjk_ratio(text) > 0.3 => "English",
        "auto" => "Chinese",
        _ => "Chinese",
    }
}

/// Map a resolved target language ("Chinese" / "English") to the two-letter
/// language code the free Google Translate endpoint expects.
pub fn google_target_lang(target_lang: &str) -> &'static str {
    match target_lang {
        "English" => "en",
        _ => "zh-CN",
    }
}

// -----------------------------------------------------------
// Translation helpers (extracted to reduce duplication)
// -----------------------------------------------------------

/// Validated configuration for a translation request.
struct ValidatedConfig {
    base_url: String,
    api_key: String,
    model: String,
    chat_url: String,
}

/// Translation prompt with system and user messages.
struct TranslationPrompt {
    system_prompt: String,
    user_content: String,
}

/// Validates input and extracts configuration from ApiConfig.
/// Returns ValidatedConfig with the chat completions URL.
fn validate_and_get_config(state: &ApiConfig, text: &str) -> Result<ValidatedConfig, String> {
    // 1. Validate input length
    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "输入文本过长（{} 字符），最多支持 {} 字符",
            text.chars().count(),
            MAX_INPUT_CHARS
        ));
    }

    // 2. Get configuration
    let (base_url, api_key, model) = {
        (
            state.base_url.lock_recover().clone(),
            state.api_key.lock_recover().clone(),
            state.model.lock_recover().clone(),
        )
    };

    // 3. Validate API key
    if api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    // 4. Validate Base URL
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }

    // 5. Build chat URL
    let chat_url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", base_url)
    };

    Ok(ValidatedConfig {
        base_url,
        api_key,
        model,
        chat_url,
    })
}

/// Builds the translation prompt with system and user messages.
/// Includes glossary if available.
fn build_translation_prompt(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> TranslationPrompt {
    let sh = if source_lang == "auto" {
        String::new()
    } else {
        format!(" (source language: {})", source_lang)
    };

    let glossary = state.glossary.lock_recover().clone();
    let system_prompt = build_system_prompt(&glossary);

    let user_content = format!(
        "Translate the following text{} to {}:\n\n{}",
        sh, target_lang, text
    );

    TranslationPrompt {
        system_prompt,
        user_content,
    }
}

/// Builds a ChatRequest with the given parameters.
fn build_chat_request(model: String, prompt: TranslationPrompt, stream: bool) -> ChatRequest {
    ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: prompt.system_prompt,
            },
            ChatMessage {
                role: "user".into(),
                content: prompt.user_content,
            },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        stream,
    }
}

/// Returns a closure that maps reqwest errors to user-friendly messages.
fn map_http_error(base_url: &str) -> impl Fn(reqwest::Error) -> String + '_ {
    move |e: reqwest::Error| {
        if e.is_timeout() {
            format!("请求超时（{}秒），请检查网络或稍后重试", TIMEOUT_SECS)
        } else if e.is_connect() {
            format!("无法连接到 {}，请检查 Base URL", base_url)
        } else {
            format!("网络请求失败: {}", e)
        }
    }
}

// -----------------------------------------------------------
// Translation
// -----------------------------------------------------------

pub async fn do_translate_async(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    // 1. Validate and get configuration
    let config = validate_and_get_config(state, text)?;

    // 2. Build translation prompt
    let prompt = build_translation_prompt(state, text, source_lang, target_lang);

    // 3. Build request body
    let body = build_chat_request(config.model, prompt, false);

    // 4. Send request
    let client = state.client.lock_recover().clone();
    let resp = client
        .post(&config.chat_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .send()
        .await
        .map_err(map_http_error(&config.base_url))?;

    // 5. Handle response
    let status = resp.status();
    if !status.is_success() {
        let b =
            String::from_utf8_lossy(&read_response_body_limited(resp).await.unwrap_or_default())
                .to_string();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期，请在设置中更新".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})，请稍后重试", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }

    let bytes = read_response_body_limited(resp).await?;

    let cr: ChatResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("解析响应 JSON 失败: {}", e))?;

    cr.choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .ok_or("API 返回了空翻译结果".into())
}

// -----------------------------------------------------------
// Free Google Translate provider
// -----------------------------------------------------------

/// Public, keyless Google Translate endpoint (the same one used by the web
/// client). Not an official API — no SLA, may change or be rate-limited.
const FREE_TRANSLATE_URL: &str = "https://translate.googleapis.com/translate_a/single";

/// Parse a `translate_a/single` response into the joined translation text.
fn parse_google_response(bytes: &[u8]) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("解析免费翻译响应失败: {}", e))?;

    // The response is `[[["译文","原文",...], ...], null, "detected-lang", ...]`.
    // Join every segment's first element to preserve line breaks exactly.
    let segments = value
        .get(0)
        .and_then(|v| v.as_array())
        .ok_or("免费翻译响应格式异常")?;
    let mut translated = String::new();
    for segment in segments {
        if let Some(text) = segment.get(0).and_then(|v| v.as_str()) {
            translated.push_str(text);
        }
    }
    let translated = translated.trim().to_string();
    if translated.is_empty() {
        return Err("免费翻译返回了空结果".into());
    }
    Ok(translated)
}

/// Translate `text` via the free Google Translate endpoint.
/// `target_lang` is the resolved "Chinese" / "English" label from
/// [`resolve_target_lang`]; source language is auto-detected server-side.
pub async fn do_free_translate_async(
    state: &ApiConfig,
    text: &str,
    target_lang: &str,
) -> Result<String, String> {
    // 1. Validate input length (mirrors the API path).
    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "输入文本过长（{} 字符），最多支持 {} 字符",
            text.chars().count(),
            MAX_INPUT_CHARS
        ));
    }
    if text.trim().is_empty() {
        return Err("请输入要翻译的文本".into());
    }

    let target = google_target_lang(target_lang);
    let client = state.client.lock_recover().clone();

    // 2. Send the keyless request. `query` percent-encodes `text` for us.
    let resp = client
        .get(FREE_TRANSLATE_URL)
        .query(&[
            ("client", "gtx"),
            ("sl", "auto"),
            ("tl", target),
            ("dt", "t"),
            ("q", text),
        ])
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .send()
        .await
        .map_err(map_http_error(FREE_TRANSLATE_URL))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            429 => "免费翻译请求过于频繁，请稍后重试".into(),
            _ => format!("免费翻译服务错误 ({})", status.as_u16()),
        });
    }

    let bytes = read_response_body_limited(resp).await?;
    parse_google_response(&bytes)
}

/// Unified translation entry point: routes to the free Google provider when
/// enabled, otherwise to the configured OpenAI-compatible API.
async fn wait_for_request_superseded(state: &ApiConfig, scope: &str, seq: u64) {
    while state.is_current_request(scope, seq) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

pub async fn do_translate_unified(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    if state.free_translation() {
        do_free_translate_async(state, text, target_lang).await
    } else {
        do_translate_async(state, text, source_lang, target_lang).await
    }
}

/// Unified translation that can be cancelled by a request in the same scope.
pub async fn do_translate_unified_scoped(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    scope: &str,
    seq: u64,
) -> Result<String, String> {
    tokio::select! {
        result = do_translate_unified(state, text, source_lang, target_lang) => result,
        _ = wait_for_request_superseded(state, scope, seq) => Err("CANCELLED".into()),
    }
}
/// Verify connectivity against the configured service with a minimal request.
/// Returns a human-readable success message on success.
pub async fn test_connection_async(
    state: &ApiConfig,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Base URL 不能为空".into());
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }
    if model.trim().is_empty() {
        return Err("模型名称不能为空".into());
    }
    if api_key.trim().is_empty() {
        return Err("请先配置 API Key".into());
    }

    let chat_url = if base_url.ends_with("/v1") {
        format!("{}/chat/completions", base_url)
    } else {
        format!("{}/v1/chat/completions", base_url)
    };
    let body = build_chat_request(
        model.trim().to_string(),
        TranslationPrompt {
            system_prompt: BASE_SYSTEM_PROMPT.to_string(),
            user_content: "你好".to_string(),
        },
        false,
    );
    let client = state.client.lock_recover().clone();
    let resp = client
        .post(&chat_url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .send()
        .await
        .map_err(map_http_error(&base_url))?;

    let status = resp.status();
    if !status.is_success() {
        let b =
            String::from_utf8_lossy(&read_response_body_limited(resp).await.unwrap_or_default())
                .to_string();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期".into(),
            404 => "模型名称无效或服务不支持该模型".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }
    let bytes = read_response_body_limited(resp).await?;
    let cr: ChatResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("解析响应 JSON 失败: {}", e))?;
    if cr.choices.is_empty() {
        return Err("服务响应格式异常：缺少 choices".into());
    }
    Ok(format!("连接成功：{}（{}）", model.trim(), base_url))
}

// -----------------------------------------------------------
// Streaming translation
// -----------------------------------------------------------

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Deserialize)]
struct StreamErrorInfo {
    message: Option<String>,
}

#[derive(Deserialize)]
struct StreamEnvelope {
    choices: Option<Vec<StreamChoice>>,
    error: Option<StreamErrorInfo>,
}

fn process_sse_line(
    line_bytes: &[u8],
    full_text: &mut String,
    on_chunk: &impl Fn(String),
) -> Result<bool, String> {
    let line = std::str::from_utf8(line_bytes)
        .map_err(|e| format!("流响应包含无效 UTF-8: {}", e))?
        .trim();
    if line.is_empty() || line.starts_with(':') {
        return Ok(false);
    }

    let Some(data) = line.strip_prefix("data:") else {
        return Ok(false);
    };
    let data = data.trim_start();
    if data == "[DONE]" {
        return Ok(true);
    }

    let envelope = serde_json::from_str::<StreamEnvelope>(data)
        .map_err(|e| format!("流响应 JSON 格式异常: {}", e))?;
    if let Some(error) = envelope.error {
        return Err(format!(
            "API 流式响应错误: {}",
            error
                .message
                .unwrap_or_else(|| "provider 返回未知错误".to_string())
        ));
    }

    let choices = envelope
        .choices
        .ok_or_else(|| "API 流响应格式异常：缺少 choices".to_string())?;
    let choice = choices
        .first()
        .ok_or_else(|| "API 流响应格式异常：choices 为空".to_string())?;
    if let Some(content) = choice.delta.content.as_ref() {
        if !content.is_empty() {
            full_text.push_str(content);
            on_chunk(content.clone());
        }
    }
    Ok(false)
}

fn finalize_stream_result(full_text: String, saw_done: bool) -> Result<String, String> {
    if !saw_done {
        return Err("流响应在收到 [DONE] 前提前结束".into());
    }
    if full_text.trim().is_empty() {
        return Err("API 流响应未返回翻译文本".into());
    }
    Ok(full_text)
}

/// Streaming translation — emits text chunks via `on_chunk` callback.
/// Returns the full accumulated translation text.
pub async fn do_translate_stream_async(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    scope: &str,
    seq: u64,
    on_chunk: impl Fn(String),
) -> Result<String, String> {
    // 1. Validate and get configuration
    let config = validate_and_get_config(state, text)?;

    // 2. Build translation prompt
    let prompt = build_translation_prompt(state, text, source_lang, target_lang);

    // 3. Build request body (with stream: true)
    let body = build_chat_request(config.model, prompt, true);

    // 4. Send streaming request
    let client = state.client.lock_recover().clone();
    let resp = tokio::select! {
        result = tokio::time::timeout(
            Duration::from_secs(TIMEOUT_SECS),
            client
                .post(&config.chat_url)
                .header("Authorization", format!("Bearer {}", config.api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send(),
        ) => {
            result
                .map_err(|_| format!("请求超时（{}秒），请检查网络或稍后重试", TIMEOUT_SECS))?
                .map_err(map_http_error(&config.base_url))?
        }
        _ = wait_for_request_superseded(state, scope, seq) => {
            return Err("CANCELLED".into());
        }
    };

    // 5. Handle response status
    let status = resp.status();
    if !status.is_success() {
        let b =
            String::from_utf8_lossy(&read_response_body_limited(resp).await.unwrap_or_default())
                .to_string();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期，请在设置中更新".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})，请稍后重试", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }

    // 6. Process streaming response
    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buffer: Vec<u8> = Vec::new();
    let mut response_bytes = 0usize;

    let mut saw_done = false;
    'stream: loop {
        // Check if a newer request has superseded this one — abort early to free the connection
        if !state.is_current_request(scope, seq) {
            return Err("CANCELLED".into());
        }

        let next_chunk = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(TIMEOUT_SECS), stream.next()) => {
                result.map_err(|_| {
                    format!(
                        "流式响应空闲超时（{}秒），请检查网络或 API 服务状态",
                        TIMEOUT_SECS
                    )
                })?
            }
            _ = wait_for_request_superseded(state, scope, seq) => {
                return Err("CANCELLED".into());
            }
        };
        let Some(chunk_result) = next_chunk else {
            break;
        };
        let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
        response_bytes = response_bytes.saturating_add(chunk.len());
        if response_bytes > MAX_RESPONSE_BYTES {
            return Err(format!(
                "API 流响应体过大（{} KB），超过限制（{} KB）",
                response_bytes / 1024,
                MAX_RESPONSE_BYTES / 1024
            ));
        }
        buffer.extend_from_slice(&chunk);

        while let Some(line_end) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=line_end).collect();
            if process_sse_line(&line, &mut full_text, &on_chunk)? {
                saw_done = true;
                break 'stream;
            }
        }
    }

    if !saw_done && !buffer.is_empty() {
        saw_done = process_sse_line(&buffer, &mut full_text, &on_chunk)?;
    }
    finalize_stream_result(full_text, saw_done)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_sequences_are_isolated_by_scope() {
        let dir = std::env::temp_dir().join(format!("vt_request_scope_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let config = ApiConfig::load_or_default(dir.clone());

        let main_request = config.next_request_seq("main");
        let quick_request = config.next_request_seq("quick");
        assert!(config.is_current_request("main", main_request));
        assert!(config.is_current_request("quick", quick_request));

        let next_quick = config.next_request_seq("quick");
        assert!(config.is_current_request("main", main_request));
        assert!(!config.is_current_request("quick", quick_request));
        assert!(config.is_current_request("quick", next_quick));

        config.cancel_current_request("main");
        assert!(!config.is_current_request("main", main_request));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn stale_request_cannot_run_commit_side_effect() {
        let dir = std::env::temp_dir().join(format!("vt_request_commit_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let config = ApiConfig::load_or_default(dir.clone());
        let first = config.next_request_seq("main");
        let second = config.next_request_seq("main");
        let mut committed = false;
        assert!(config
            .with_current_request("main", second, || committed = true)
            .is_some());
        assert!(config
            .with_current_request("main", first, || committed = true)
            .is_none());
        assert!(committed);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn zh2en_always_targets_english() {
        assert_eq!(resolve_target_lang("hello", "zh2en"), "English");
        assert_eq!(resolve_target_lang("你好", "zh2en"), "English");
    }

    #[test]
    fn en2zh_always_targets_chinese() {
        assert_eq!(resolve_target_lang("hello", "en2zh"), "Chinese");
        assert_eq!(resolve_target_lang("你好", "en2zh"), "Chinese");
    }

    #[test]
    fn auto2zh_always_targets_chinese() {
        assert_eq!(resolve_target_lang("hello", "auto2zh"), "Chinese");
        assert_eq!(resolve_target_lang("你好", "auto2zh"), "Chinese");
    }

    #[test]
    fn auto2en_always_targets_english() {
        assert_eq!(resolve_target_lang("hello", "auto2en"), "English");
        assert_eq!(resolve_target_lang("你好", "auto2en"), "English");
    }

    #[test]
    fn internal_auto_detects_chinese_and_targets_english() {
        assert_eq!(
            resolve_target_lang("你好世界，这是一段中文文本", "auto"),
            "English"
        );
    }

    #[test]
    fn internal_auto_detects_english_and_targets_chinese() {
        assert_eq!(
            resolve_target_lang("hello world, this is english text", "auto"),
            "Chinese"
        );
    }

    #[test]
    fn empty_auto_text_defaults_to_chinese_target() {
        assert_eq!(resolve_target_lang("", "auto"), "Chinese");
    }

    #[test]
    fn cjk_ratio_is_zero_for_pure_ascii() {
        assert_eq!(cjk_ratio("hello world"), 0.0);
    }

    #[test]
    fn cjk_ratio_is_one_for_pure_chinese() {
        assert_eq!(cjk_ratio("你好世界"), 1.0);
    }

    #[test]
    fn cjk_ratio_handles_mixed_text() {
        let ratio = cjk_ratio("hi你好");
        assert!(ratio > 0.0 && ratio < 1.0);
    }

    #[test]
    fn google_target_lang_maps_resolved_labels() {
        assert_eq!(google_target_lang("English"), "en");
        assert_eq!(google_target_lang("Chinese"), "zh-CN");
        assert_eq!(google_target_lang("anything-else"), "zh-CN");
    }

    #[test]
    fn parse_google_response_joins_segments_and_preserves_newlines() {
        let body = r#"[[["第一行。\n","First line.\n",null,null,3],["第二行。","Second line.",null,null,3]],null,"en"]"#;
        let parsed = parse_google_response(body.as_bytes()).unwrap();
        assert_eq!(parsed, "第一行。\n第二行。");
    }

    #[test]
    fn parse_google_response_rejects_missing_segments() {
        assert!(parse_google_response(br#"null"#).is_err());
        assert!(parse_google_response(br#"[]"#).is_err());
    }

    #[test]
    fn sse_line_decodes_chinese_and_accepts_missing_space() {
        let mut full_text = String::new();
        let chunks = std::sync::Mutex::new(Vec::new());
        let line = r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#;
        let done = process_sse_line(line.as_bytes(), &mut full_text, &|chunk| {
            chunks.lock_recover().push(chunk);
        })
        .unwrap();
        assert!(!done);
        assert_eq!(full_text, "你好");
        assert_eq!(*chunks.lock_recover(), vec!["你好"]);
    }

    #[test]
    fn sse_provider_error_is_returned() {
        let mut full_text = String::new();
        let error = process_sse_line(
            br#"data:{"error":{"message":"quota exceeded"}}"#,
            &mut full_text,
            &|_| {},
        )
        .unwrap_err();
        assert!(error.contains("quota exceeded"));
    }

    #[test]
    fn sse_malformed_json_is_returned() {
        let mut full_text = String::new();
        let error = process_sse_line(b"data:{bad-json}", &mut full_text, &|_| {}).unwrap_err();
        assert!(error.contains("JSON"));
    }

    #[test]
    fn sse_missing_choices_is_returned() {
        let mut full_text = String::new();
        let error = process_sse_line(b"data:{}", &mut full_text, &|_| {}).unwrap_err();
        assert!(error.contains("choices"));
    }

    #[test]
    fn stream_result_requires_done_and_text() {
        assert!(finalize_stream_result("partial".to_string(), false).is_err());
        assert!(finalize_stream_result("   ".to_string(), true).is_err());
        assert_eq!(
            finalize_stream_result("done".to_string(), true).unwrap(),
            "done"
        );
    }

    #[test]
    fn failed_config_save_restores_in_memory_state() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vt_config_rollback_{}_{}",
            std::process::id(),
            suffix
        ));
        let _ = std::fs::create_dir_all(&dir);
        let config = ApiConfig::load_or_default(dir.clone());
        let original = config.free_translation();
        let config_path = dir.join("config.json");
        std::fs::remove_file(&config_path).unwrap();
        std::fs::create_dir(&config_path).unwrap();

        let result = config.set_free_translation(!original);
        assert!(result.is_err());
        assert_eq!(config.free_translation(), original);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn saving_config_preserves_ball_position_fields() {
        let dir = std::env::temp_dir().join(format!("vt_config_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("config.json");
        std::fs::write(
            &path,
            r#"{"base_url":"https://api.openai.com","model":"test","ball_x":321,"ball_y":654}"#,
        )
        .unwrap();
        let config = ApiConfig::load_or_default(dir.clone());
        *config.model.lock_recover() = "updated".into();
        config.save_to_disk().unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["ball_x"], 321);
        assert_eq!(saved["ball_y"], 654);
        assert_eq!(saved["model"], "updated");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn translation_context_hash_is_stable_and_tracks_settings() {
        let dir = std::env::temp_dir().join(format!("vt_ctx_hash_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let config = ApiConfig::load_or_default(dir.clone());

        let first = config.translation_context_hash();
        let second = config.translation_context_hash();
        assert_eq!(first, second);
        assert_eq!(first.len(), 16);

        *config.model.lock_recover() = "deepseek-chat".into();
        assert_ne!(first, config.translation_context_hash());

        let _ = std::fs::remove_dir_all(dir);
    }
}
