use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

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
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };
    use windows::core::HSTRING;

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
    use windows::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    use windows::core::HSTRING;

    let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        if CredReadW(&HSTRING::from(CRED_TARGET), CRED_TYPE_GENERIC, 0, &mut pcred).is_err() {
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
        if key.is_empty() { None } else { Some(key) }
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
    /// Hotkey bindings stored as (action, shortcut_string).
    /// Actions: "translate", "screenshot", "replace".
    pub hotkeys: Mutex<Vec<(String, String)>>,
    /// Custom glossary: Vec of (source, target) term pairs.
    pub glossary: Mutex<Vec<(String, String)>>,
    /// Maximum history records to keep.
    pub max_records: std::sync::atomic::AtomicUsize,
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
}

fn default_max_records() -> usize {
    200
}

impl ApiConfig {
    pub fn load_or_default(config_dir: std::path::PathBuf) -> Self {
        let config_path = config_dir.join("config.json");
        let (base_url, model, hotkeys, glossary, max_records, config_existed) =
            std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|d| serde_json::from_str::<PersistedConfig>(&d).ok())
                .map(|c| (c.base_url, c.model, c.hotkeys, c.glossary, c.max_records, true))
                .unwrap_or_else(|| {
                    let (b, _, m) = Self::defaults();
                    (b, m, Self::default_hotkeys(), Vec::new(), default_max_records(), false)
                });
        let api_key = load_api_key_credential().unwrap_or_default();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
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
            hotkeys: Mutex::new(if hotkeys.is_empty() { Self::default_hotkeys() } else { hotkeys }),
            glossary: Mutex::new(glossary),
            max_records: std::sync::atomic::AtomicUsize::new(max_records),
        };
        // Only persist when the file didn't exist — avoid a sync write on every cold start
        if !config_existed {
            this.save_to_disk();
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

    pub fn save_to_disk(&self) {
        let cfg = PersistedConfig {
            base_url: self.base_url.lock().unwrap().clone(),
            model: self.model.lock().unwrap().clone(),
            hotkeys: self.hotkeys.lock().unwrap().clone(),
            glossary: self.glossary.lock().unwrap().clone(),
            max_records: self.max_records.load(std::sync::atomic::Ordering::Relaxed),
        };
        if let Some(p) = self.config_path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let tmp_path = self.config_path.with_extension("json.tmp");
        match serde_json::to_string_pretty(&cfg) {
            Ok(j) => {
                if std::fs::write(&tmp_path, j).is_ok() {
                    if std::fs::rename(&tmp_path, &self.config_path).is_err() {
                        let _ = std::fs::remove_file(&tmp_path);
                    }
                }
            }
            Err(e) => {
                log::error!("[config] Failed to serialize config: {}", e);
            }
        }
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
// Translation
// -----------------------------------------------------------

pub async fn do_translate_async(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "输入文本过长（{} 字符），最多支持 {} 字符",
            text.chars().count(),
            MAX_INPUT_CHARS
        ));
    }

    let (base_url, api_key, model) = {
        (
            state.base_url.lock().unwrap().clone(),
            state.api_key.lock().unwrap().clone(),
            state.model.lock().unwrap().clone(),
        )
    };

    if api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }

    let url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", base_url)
    };

    let sh = if source_lang == "auto" {
        String::new()
    } else {
        format!(" (source language: {})", source_lang)
    };
    let glossary = state.glossary.lock().unwrap().clone();
    let system_prompt = build_system_prompt(&glossary);
    let body = ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: system_prompt,
            },
            ChatMessage {
                role: "user".into(),
                content: format!(
                    "Translate the following text{} to {}:\n\n{}",
                    sh, target_lang, text
                ),
            },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: false,
    };

    let client = state.client.lock().unwrap().clone();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时 (30s)，请检查网络或 API 服务状态".into()
            } else if e.is_connect() {
                format!("无法连接到 {}，请检查 Base URL 和网络", base_url)
            } else {
                format!("请求失败: {}", e)
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let b = resp.text().await.unwrap_or_default();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期，请在设置中更新".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})，请稍后重试", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }

    let bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", e))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "API 响应体过大（{} KB），超过限制（{} KB）",
            bytes.len() / 1024,
            MAX_RESPONSE_BYTES / 1024
        ));
    }

    let cr: ChatResponse =
        serde_json::from_slice(&bytes).map_err(|e| format!("解析响应 JSON 失败: {}", e))?;

    cr.choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .ok_or("API 返回了空翻译结果".into())
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

/// Streaming translation — emits text chunks via `on_chunk` callback.
/// Returns the full accumulated translation text.
pub async fn do_translate_stream_async(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    on_chunk: impl Fn(String),
) -> Result<String, String> {
    use futures_util::StreamExt;

    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "输入文本过长（{} 字符），最多支持 {} 字符",
            text.chars().count(),
            MAX_INPUT_CHARS
        ));
    }

    let (base_url, api_key, model) = {
        (
            state.base_url.lock().unwrap().clone(),
            state.api_key.lock().unwrap().clone(),
            state.model.lock().unwrap().clone(),
        )
    };

    if api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err("Base URL 必须以 http:// 或 https:// 开头".into());
    }

    let url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", base_url)
    };

    let sh = if source_lang == "auto" {
        String::new()
    } else {
        format!(" (source language: {})", source_lang)
    };
    let glossary = state.glossary.lock().unwrap().clone();
    let system_prompt = build_system_prompt(&glossary);
    let body = ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system".into(),
                content: system_prompt,
            },
            ChatMessage {
                role: "user".into(),
                content: format!(
                    "Translate the following text{} to {}:\n\n{}",
                    sh, target_lang, text
                ),
            },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        stream: true,
    };

    let client = state.client.lock().unwrap().clone();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "请求超时 (30s)，请检查网络或 API 服务状态".into()
            } else if e.is_connect() {
                format!("无法连接到 {}，请检查 Base URL 和网络", base_url)
            } else {
                format!("请求失败: {}", e)
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let b = resp.text().await.unwrap_or_default();
        return Err(match status.as_u16() {
            401 => "API Key 无效或已过期，请在设置中更新".into(),
            429 => "API 请求频率超限，请稍后重试".into(),
            500..=599 => format!("API 服务内部错误 ({})，请稍后重试", status.as_u16()),
            _ => format!("API 错误 ({}): {}", status.as_u16(), b),
        });
    }

    let mut stream = resp.bytes_stream();
    let mut full_text = String::new();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("流读取失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete SSE lines
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                let data = data.trim();
                if data == "[DONE]" {
                    // Process any remaining buffer lines before returning
                    while let Some(line_end) = buffer.find('\n') {
                        let remaining = buffer[..line_end].trim().to_string();
                        buffer = buffer[line_end + 1..].to_string();
                        if remaining.is_empty() || remaining.starts_with(':') {
                            continue;
                        }
                        if let Some(d) = remaining.strip_prefix("data: ") {
                            let d = d.trim();
                            if d == "[DONE]" { break; }
                            if let Ok(c) = serde_json::from_str::<StreamChunk>(d) {
                                if let Some(choice) = c.choices.first() {
                                    if let Some(content) = &choice.delta.content {
                                        if !content.is_empty() {
                                            full_text.push_str(content);
                                            on_chunk(content.clone());
                                        }
                                    }
                                }
                            }
                        }
                    }
                    return Ok(full_text);
                }

                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = chunk.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            if !content.is_empty() {
                                full_text.push_str(content);
                                on_chunk(content.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    // Process any remaining buffer (stream ended without [DONE] or trailing newline)
    if !buffer.trim().is_empty() {
        let line = buffer.trim().to_string();
        if let Some(data) = line.strip_prefix("data: ") {
            let data = data.trim();
            if data != "[DONE]" {
                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = chunk.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            if !content.is_empty() {
                                full_text.push_str(content);
                                on_chunk(content.clone());
                            }
                        }
                    }
                }
            }
        }
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
}
