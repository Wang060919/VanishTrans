# VanishTrans 开发路线图

> 最后更新：2026-07-14

---

## Phase 1 — 已完成 ✅

| 编号 | 内容 | 状态 |
|------|------|------|
| 1.4 | `keyboard.rs` 用 `vk::COPY` / `vk::PASTE` 命名常量替代硬编码 `0x43` / `0x56` | ✅ |
| 2.4 | `Typewriter` 组件对 >200 字符的文本跳过打字机效果，直接渲染 | ✅ |
| 3.5 | 抽取共享 `TranslationRecord` 类型到 `src/types.ts`，消除重复定义 | ✅ |
| 4.3 | 历史搜索增加 200ms debounce，减少每次按键的 IPC 调用 | ✅ |
| 4.4 | 翻译错误状态旁添加 🔄 重试按钮 | ✅ |

---

## Phase 2 — 已完成 ✅

| 编号 | 内容 | 状态 |
|------|------|------|
| F1 | 翻译流式输出 — SSE streaming + 前端增量渲染 | ✅ |
| F3 | 快捷键自定义 — HotkeyEditor 组件 + 动态注册 | ✅ |
| F5 | 术语表 — glossary 持久化 + system prompt 注入 | ✅ |
| 3.1 | lib.rs 拆分 — setup/tray/shortcuts/clipboard_watch 模块 | ✅ |

### F1 — 翻译流式输出 (Streaming) ✅

**目标**：翻译请求使用 SSE 流式返回，用户可逐字看到结果，大幅改善感知速度。

**实现要点**：
- 后端 `ChatRequest.stream = true`
- Rust 侧用 `reqwest::Response` 的 `bytes_stream()` 逐 chunk 读取 SSE data
- 通过 Tauri 事件 `translate-stream-chunk` 逐段发送到前端
- 新增 `translate-stream-end` 事件标记完成
- 前端 `useTauriEvents` 新增监听，`useTranslation` 中追加文本到 output
- 保留 `stream: false` 作为 fallback（当网络不支持 SSE 时）

**影响范围**：
- `src-tauri/src/translate.rs` — 新增 `do_translate_stream_async()`
- `src-tauri/src/commands.rs` — 新增 `translate_stream` command
- `src/hooks/useTranslation.ts` — 修改 `doTranslate` 逻辑
- `src/hooks/useTauriEvents.ts` — 新增 stream 事件监听

---

### F3 — 翻译快捷键自定义 ✅

**目标**：用户可在设置面板自定义 Alt+Q / Alt+R / Alt+W 的快捷键组合。

**实现要点**：
- 前端设置面板新增「快捷键」区域
- 用 `onKeyDown` 捕获用户按键组合，显示为 "Ctrl+Shift+T" 格式
- 保存时调用 `set_hotkeys` command
- 后端先 `unregister` 所有旧快捷键，再用新组合 `register`
- `lib.rs` 的 shortcut handler 从 `ApiConfig.hotkeys` 读取映射

**影响范围**：
- `src/features/SettingsPanel.tsx` — 新增快捷键编辑 UI
- `src-tauri/src/lib.rs` — shortcut 注册逻辑改为动态
- `src-tauri/src/commands.rs` — `set_hotkeys` 已存在，需增强

---

### F5 — 术语表 / 自定义词典 ✅

**目标**：用户可设置固定术语翻译规则（如 "AI" → "人工智能"），优先级高于模型翻译。

**实现要点**：
- `ApiConfig` 新增 `glossary: Vec<(String, String)>`
- 持久化到 `config.json` 的 `glossary` 字段
- `SYSTEM_PROMPT` 末尾追加：`Use the following glossary for fixed translations: ...`
- 前端设置面板新增术语管理：增/删/改列表
- 术语表注入到每次翻译请求的 system prompt 中

**影响范围**：
- `src-tauri/src/translate.rs` — `SYSTEM_PROMPT` 动态化
- `src/features/SettingsPanel.tsx` — 新增术语管理 UI

---

### 3.1 — `lib.rs` 拆分 ✅

**目标**：将 `run()` 函数中 >350 行的 setup 逻辑拆分为独立模块。

**拆分方案**：
```
lib.rs         → run() 主入口 + 全局状态定义
setup/tray.rs  → setup_tray() 系统托盘
setup/shortcut.rs → setup_shortcuts() 全局快捷键
setup/watch.rs → setup_clipboard_watch() 剪贴板监听
setup/http.rs  → warmup_http_pool() 连接池预热
```

---

## Phase 3 — 中期规划（建议 1-2 个月内完成）

### F2 — 多翻译引擎支持

**目标**：支持除 OpenAI 兼容 API 之外的翻译引擎。

**计划支持的引擎**：
| 引擎 | API 格式 | 优先级 |
|------|----------|--------|
| DeepL | REST JSON | ⭐⭐⭐ |
| Google Translate | REST JSON | ⭐⭐⭐ |
| 百度翻译 | REST + sign | ⭐⭐ |
| Ollama 本地 | OpenAI 兼容 | ⭐⭐ |

**实现要点**：
- `ApiConfig` 新增 `engine: String` 字段
- 各引擎实现独立的 `translate_xxx_async()` 函数
- 前端设置面板：引擎下拉 → 动态显示该引擎需要的配置项
- `config.json` 结构扩展

---

### F4 — 输入文本拖拽 / 文件翻译

**目标**：支持拖拽 `.txt` / `.srt` / `.json` 等文件到窗口，自动读取内容并翻译。

**实现要点**：
- 前端 `TranslatePanel` 监听 `dragover` / `drop` 事件
- 读取文件内容填入输入框
- 对 `.srt` 字幕文件：解析时间码结构，只翻译文本部分，保持时间码不变
- 对 `.json` 文件：递归翻译 value，保留 key 和 JSON 结构
- 文件 >50KB 时提示用户确认

---

### F6 — 翻译结果一键朗读 (TTS)

**目标**：翻译结果旁添加朗读按钮，辅助语言学习。

**实现方案对比**：
| 方案 | 优点 | 缺点 |
|------|------|------|
| Web Speech API | 前端直接调用，无需 Rust 依赖 | 语音质量一般，不支持所有语言 |
| Windows SpeechSynthesizer | 系统级语音，质量好 | 需要 Windows crate 额外 feature |

**推荐**：Web Speech API（简单、跨平台潜力）

---

### F8 — 检测语言显示

**目标**：翻译完成后显示"检测到：英文 → 中文"信息。

**实现要点**：
- 在翻译 prompt 中要求模型返回简短的 `detected_language`
- 后端解析返回，在翻译结果旁附带语言信息
- 前端在输出区域下方小字显示

---

### F9 — 历史记录导出

**目标**：支持导出翻译历史为 CSV / TXT / SRT 格式。

**实现要点**：
- 后端新增 `export_history` command，接受 `format` 参数
- CSV：`original,translated,direction,timestamp`
- TXT：逐条记录，用空行分隔
- SRT：将翻译历史导出为字幕格式（假设原文=译文的时间码对应）
- 前端历史面板新增导出按钮，弹出格式选择

---

## Phase 4 — 长期愿景

### F10 — 全局悬浮翻译球

桌面常驻一个小翻译球图标，用户可将选中文本拖拽到球上触发翻译。类似 macOS 上的 Bob /划词翻译工具。

**技术要点**：
- 新建一个 always-on-top、无边框、小尺寸（64×64）的 Tauri 窗口
- 监听 dragover/drop 事件
- 翻译结果以 popover 形式在球旁边展示

---

### F11 — 翻译记忆 (TM)

类似 CAT 工具的翻译记忆功能，对重复出现的句子缓存翻译结果，减少 API 调用。

**技术要点**：
- 本地 SQLite 存储原文-译文对
- 新翻译前先查 TM，命中率 >90% 直接返回
- 支持 TM 的增删改查和导出

---

### F12 — 插件系统

允许用户编写自定义翻译引擎 / 后处理插件。

**技术要点**：
- 定义插件接口（JS/TS 脚本或 WASM）
- 插件目录：`~/.vanish-trans/plugins/`
- 前端设置面板管理插件的启用/禁用/配置

---

### F13 — 自动更新

集成 Tauri updater plugin，支持检查更新和自动下载安装。

**技术要点**：
- 配置 `tauri-plugin-updater`
- 设置更新服务器（GitHub Releases 或自建）
- 前端在设置面板显示当前版本 + "检查更新" 按钮

---

### F14 — OCR 语言选择

当前 `OcrEngine::TryCreateFromUserProfileLanguages()` 只使用系统语言，支持用户在设置中指定 OCR 识别语言。

**技术要点**：
- `OcrEngine::TryCreateFromLanguage(languageTag)` 可指定语言
- 前端设置面板增加 OCR 语言下拉
- 需要安装对应语言包（Windows Settings → Time & Language）

---

### F15 — 多显示器截图

当前只截取主显示器，支持选择任意显示器或全屏拼接。

**技术要点**：
- `Monitor::all()` 获取所有显示器
- 前端新增显示器选择 UI（或自动截取所有显示器拼接）
- 考虑高 DPI 缩放的坐标映射

---

## 优化待办（持续改进）

| 编号 | 内容 | 优先级 |
|------|------|--------|
| 1.1 | OCR 临时文件用 `tempfile` 或 UUID 命名，避免竞争和残留 | 中 |
| 1.2 | 窗口自动隐藏改用 JS 层 `setTimeout` 替代裸线程 sleep | 低 |
| 1.3 | `ClipboardGuard` hash 碰撞风险评估，必要时改用双 hash 或文本比对 | 低 |
| 2.1 | `cjk_ratio` 对长文本采样优化 | 低 |
| 2.2 | OCR 流程跳过 PNG 写盘，用内存 stream 创建 BitmapDecoder | 中 |
| 2.3 | 剪贴板监听改用 `AddClipboardFormatListener` 事件驱动 | 中 |
| 3.2 | Alt+R 翻译逻辑从 `lib.rs` 提取为独立函数 | 中 |
| 3.3 | `Direction` 统一为 Rust enum + 前端常量 | 低 |
| 3.4 | `MAX_RECORDS` 改为可配置或提升到 200-500 | 低 |
| 4.1 | TranslatePanel 增加 overflow 保护 | 低 |
| 4.2 | 设置保存后增加轻量 toast 反馈 | 低 |
