# translate.rs 重构方案

## 当前问题
- `do_translate_async` 和 `do_translate_stream_async` 有 ~150 行重复代码
- URL 构建、请求体构建、错误处理都是重复的
- 难以维护和测试

## 重复代码清单

### 1. 输入验证
```rust
if text.chars().count() > MAX_INPUT_CHARS {
    return Err(format!(
        "输入文本过长（{} 字符），最多支持 {} 字符",
        text.chars().count(),
        MAX_INPUT_CHARS
    ));
}
```

### 2. 获取配置
```rust
let (base_url, api_key, model) = {
    (
        state.base_url.lock().unwrap().clone(),
        state.api_key.lock().unwrap().clone(),
        state.model.lock().unwrap().clone(),
    )
};
```

### 3. API Key 验证
```rust
if api_key.is_empty() {
    return Err("请先在设置中配置 API Key".into());
}
```

### 4. Base URL 验证
```rust
if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
    return Err("Base URL 必须以 http:// 或 https:// 开头".into());
}
```

### 5. URL 构建
```rust
let url = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
} else {
    format!("{}/v1/chat/completions", base_url.trim_end_matches('/'))
};
```

### 6. 系统提示词生成
```rust
let system_prompt = format!("{}\n\n{}", BASE_SYSTEM_PROMPT, direction);
```

### 7. 请求体构建
```rust
let body = ChatRequest {
    model,
    messages: vec![
        ChatMessage {
            role: "system".into(),
            content: system_prompt,
        },
        ChatMessage {
            role: "user".into(),
            content: text.into(),
        },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    stream: false, // or true
};
```

### 8. HTTP 错误映射
```rust
.map_err(|e| {
    if e.is_timeout() {
        format!("请求超时（{}秒），请检查网络或稍后重试", TIMEOUT_SECS)
    } else if e.is_connect() {
        format!("无法连接到 {}，请检查 Base URL", base_url)
    } else {
        format!("网络请求失败: {}", e)
    }
})?
```

---

## 重构方案

### 新增辅助结构体

```rust
/// 翻译请求的验证配置
struct ValidatedConfig {
    base_url: String,
    api_key: String,
    model: String,
    chat_url: String,
}

/// 翻译方向的系统提示词
struct TranslationPrompt {
    system_prompt: String,
    user_content: String,
}
```

### 新增辅助函数

#### 1. validate_and_get_config
```rust
fn validate_and_get_config(
    state: &ApiConfig,
    text: &str,
) -> Result<ValidatedConfig, String>
```
- 验证输入长度
- 获取配置
- 验证 API Key
- 验证 Base URL
- 构建 chat URL

#### 2. build_translation_prompt
```rust
fn build_translation_prompt(
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> TranslationPrompt
```
- 生成翻译方向提示
- 构建系统提示词
- 返回完整提示

#### 3. build_chat_request
```rust
fn build_chat_request(
    model: String,
    prompt: TranslationPrompt,
    stream: bool,
) -> ChatRequest
```
- 构建请求体
- 设置 temperature 和 max_tokens
- 设置是否流式

#### 4. map_http_error
```rust
fn map_http_error(base_url: &str) -> impl Fn(reqwest::Error) -> String + '_
```
- 返回闭包用于映射 HTTP 错误
- 统一错误消息格式

---

## 重构后的代码结构

```rust
// 辅助函数（新增约 120 行）
fn validate_and_get_config(...) -> Result<ValidatedConfig, String> { ... }
fn build_translation_prompt(...) -> TranslationPrompt { ... }
fn build_chat_request(...) -> ChatRequest { ... }
fn map_http_error(...) -> impl Fn(reqwest::Error) -> String { ... }

// 简化后的主函数（从 160 行减少到 40 行）
pub async fn do_translate_async(...) -> Result<String, String> {
    let config = validate_and_get_config(state, text)?;
    let prompt = build_translation_prompt(text, source_lang, target_lang);
    let body = build_chat_request(config.model, prompt, false);
    
    // 发送请求
    let response = client.post(&config.chat_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(map_http_error(&config.base_url))?;
    
    // 处理响应
    ...
}

// 简化后的流式函数（从 140 行减少到 50 行）
pub async fn do_translate_stream_async(...) -> Result<String, String> {
    let config = validate_and_get_config(state, text)?;
    let prompt = build_translation_prompt(text, source_lang, target_lang);
    let body = build_chat_request(config.model, prompt, true);
    
    // 发送流式请求
    let response = client.post(&config.chat_url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(map_http_error(&config.base_url))?;
    
    // 处理流式响应
    ...
}
```

---

## 预期收益

### 代码量
- 当前：402-561 行（do_translate_async）+ 564-703 行（do_translate_stream_async）= **298 行**
- 重构后：120 行（辅助函数）+ 40 行（async）+ 50 行（stream）= **210 行**
- **减少：88 行（~30%）**

### 可维护性
- ✅ 统一的配置验证
- ✅ 统一的错误处理
- ✅ 更容易测试（辅助函数可以单独测试）
- ✅ 更容易修改（只需改一个地方）

### 测试覆盖
- ✅ 可以为每个辅助函数编写单元测试
- ✅ 更容易 mock 和测试边界情况

---

## 实施步骤

1. ✅ 分析重复代码（已完成）
2. 创建 `ValidatedConfig` 和 `TranslationPrompt` 结构体
3. 实现 `validate_and_get_config` 函数
4. 实现 `build_translation_prompt` 函数
5. 实现 `build_chat_request` 函数
6. 实现 `map_http_error` 函数
7. 重构 `do_translate_async` 使用新函数
8. 重构 `do_translate_stream_async` 使用新函数
9. 运行测试确保功能正常
10. 提交

---

## 风险和缓解

### 风险
1. **引入 bug** - 重构可能改变行为
2. **性能回归** - 额外的函数调用

### 缓解
1. **充分测试** - 运行所有现有测试
2. **手动测试** - 测试翻译功能
3. **代码审查** - 仔细检查逻辑
4. **性能优化** - inline 小函数（编译器会自动优化）

---

## 时间估算

- 步骤 2-6（创建辅助函数）：1 小时
- 步骤 7-8（重构主函数）：1 小时
- 步骤 9-10（测试和提交）：0.5 小时

**总计：2.5 小时**
