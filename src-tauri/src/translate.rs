use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

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
    /// Monotonically increasing counter — each new translation request
    /// increments this. In-flight requests check the value after the HTTP
    /// round-trip and silently discard their result if it no longer matches.
    pub request_seq: AtomicU64,
    /// Independent cancellation domain for Alt+R replacement. Splitting this
    /// from `request_seq` keeps a background replacement from cancelling an
    /// in-flight main-window translation and vice versa.
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

impl ApiConfig {
    pub fn load_or_default(config_dir: std::path::PathBuf) -> Self {
        let config_path = config_dir.join("config.json");
        let (base_url, model, hotkeys, glossary, max_records, profiles, config_existed) =
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|d| serde_json::from_str::<PersistedConfig>(&d).ok())
                .map(|c| {
                    (
                        c.base_url,
                        c.model,
                        c.hotkeys,
                        c.glossary,
                        c.max_records,
                        c.profiles,
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
            request_seq: AtomicU64::new(0),
            replace_request_seq: AtomicU64::new(0),
            hotkeys: Mutex::new(if hotkeys.is_empty() {
                Self::default_hotkeys()
            } else {
                hotkeys
            }),
            glossary: Mutex::new(glossary),
            max_records: std::sync::atomic::AtomicUsize::new(max_records),
            profiles: Mutex::new(profiles),
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

    pub fn save_to_disk(&self) -> Result<(), String> {
        let _lock = CONFIG_FILE_LOCK.lock().unwrap();
        let cfg = PersistedConfig {
            base_url: self.base_url.lock().unwrap().clone(),
            model: self.model.lock().unwrap().clone(),
            hotkeys: self.hotkeys.lock().unwrap().clone(),
            glossary: self.glossary.lock().unwrap().clone(),
            max_records: self.max_records.load(std::sync::atomic::Ordering::Relaxed),
            profiles: self.profiles.lock().unwrap().clone(),
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
        let key = self.api_key.lock().unwrap().clone();
        save_api_key_credential(&key)
    }

    /// Claim a new translation sequence number. The caller stores this and
    /// checks it after the HTTP response to decide whether to keep the result.
    pub fn next_request_seq(&self) -> u64 {
        self.request_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Returns true if `seq` is still the latest request (i.e., has not been
    /// superseded by a newer translation).
    pub fn is_current_request(&self, seq: u64) -> bool {
        self.request_seq.load(Ordering::SeqCst) == seq
    }

    /// Claim a new Alt+R replacement sequence number.
    pub fn next_replace_request_seq(&self) -> u64 {
        self.replace_request_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Returns true if `seq` is still the latest Alt+R replacement request.
    pub fn is_current_replace_request(&self, seq: u64) -> bool {
        self.replace_request_seq.load(Ordering::SeqCst) == seq
    }

    /// Replace the saved profile with the same name, or append it.
    pub fn upsert_profile(&self, profile: ServiceProfile) -> Result<(), String> {
        let mut profiles = self.profiles.lock().unwrap();
        if let Some(existing) = profiles
            .iter_mut()
            .find(|existing| existing.name == profile.name)
        {
            *existing = profile;
        } else {
            profiles.push(profile);
        }
        drop(profiles);
        self.save_to_disk()
    }

    pub fn delete_profile(&self, name: &str) -> Result<(), String> {
        let mut profiles = self.profiles.lock().unwrap();
        profiles.retain(|profile| profile.name != name);
        drop(profiles);
        self.save_to_disk()
    }

    /// Apply a saved profile's base URL and model to the active configuration.
    pub fn apply_profile(&self, name: &str) -> Result<(), String> {
        let profiles = self.profiles.lock().unwrap();
        let profile = profiles
            .iter()
            .find(|profile| profile.name == name)
            .ok_or_else(|| format!("找不到服务档案: {}", name))?;
        let base_url = profile.base_url.clone();
        let model = profile.model.clone();
        drop(profiles);
        *self.base_url.lock().unwrap() = base_url;
        *self.model.lock().unwrap() = model;
        self.save_to_disk()
    }

    /// Fingerprint every setting that can change a translation result.
    /// TM entries are scoped to this value so changing provider, model, or
    /// glossary cannot silently return a result produced by stale settings.
    pub fn translation_context_hash(&self) -> String {
        let mut hasher = DefaultHasher::new();
        "vanish-trans-context-v1".hash(&mut hasher);
        self.base_url
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .hash(&mut hasher);
        self.model
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .hash(&mut hasher);
        self.glossary
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .hash(&mut hasher);
        format!("{:016x}", hasher.finish())
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
            state.base_url.lock().unwrap().clone(),
            state.api_key.lock().unwrap().clone(),
            state.model.lock().unwrap().clone(),
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

    let glossary = state.glossary.lock().unwrap().clone();
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
    let client = state.client.lock().unwrap().clone();
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
    let client = state.client.lock().unwrap().clone();
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
struct StreamChunk {
    choices: Vec<StreamChoice>,
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

    if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
        if let Some(content) = chunk
            .choices
            .first()
            .and_then(|choice| choice.delta.content.as_ref())
        {
            if !content.is_empty() {
                full_text.push_str(content);
                on_chunk(content.clone());
            }
        }
    }
    Ok(false)
}

/// Streaming translation — emits text chunks via `on_chunk` callback.
/// Returns the full accumulated translation text.
pub async fn do_translate_stream_async(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
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
    let client = state.client.lock().unwrap().clone();
    let resp = tokio::time::timeout(
        Duration::from_secs(TIMEOUT_SECS),
        client
            .post(&config.chat_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send(),
    )
    .await
    .map_err(|_| format!("请求超时（{}秒），请检查网络或稍后重试", TIMEOUT_SECS))?
    .map_err(map_http_error(&config.base_url))?;

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

    loop {
        // Check if a newer request has superseded this one — abort early to free the connection
        if !state.is_current_request(seq) {
            return Err("CANCELLED".into());
        }

        let next_chunk = tokio::time::timeout(Duration::from_secs(TIMEOUT_SECS), stream.next())
            .await
            .map_err(|_| {
                format!(
                    "流式响应空闲超时（{}秒），请检查网络或 API 服务状态",
                    TIMEOUT_SECS
                )
            })?;
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
                return Ok(full_text);
            }
        }
    }

    if !buffer.is_empty() {
        let _ = process_sse_line(&buffer, &mut full_text, &on_chunk)?;
    }

    Ok(full_text)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn sse_line_decodes_chinese_and_accepts_missing_space() {
        let mut full_text = String::new();
        let chunks = std::sync::Mutex::new(Vec::new());
        let line = r#"data:{"choices":[{"delta":{"content":"你好"}}]}"#;
        let done = process_sse_line(line.as_bytes(), &mut full_text, &|chunk| {
            chunks.lock().unwrap().push(chunk);
        })
        .unwrap();
        assert!(!done);
        assert_eq!(full_text, "你好");
        assert_eq!(*chunks.lock().unwrap(), vec!["你好"]);
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
        *config.model.lock().unwrap() = "updated".into();
        config.save_to_disk().unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["ball_x"], 321);
        assert_eq!(saved["ball_y"], 654);
        assert_eq!(saved["model"], "updated");
        let _ = std::fs::remove_dir_all(dir);
    }
}
