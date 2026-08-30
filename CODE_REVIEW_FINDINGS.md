# VanishTrans 代码审查记录
> 审查期间已在当前工作树实施修复；本文件同时记录修复前发现、当前状态和剩余验证盲区。
> 审查基准：`main` 分支，HEAD `b9819ef`（`docs: add four-stage completion verification report`）。

## 1. 审查结论摘要

当前工作树已完成核心并发、生命周期、IPC 和持久化修复，并通过 Windows `pnpm check`（19/19 文件、165/165 测试）、Rust 91/91、TypeScript、`eslint src` 和 Windows NSIS bundle 验证。仍存在验证边界：WSL 多文件 Vitest runner 不稳定，真实 Windows 原生 OCR/剪贴板/跨窗口集成、Credential Manager 异常和 GitHub CI/release run 尚未验证。

已修复的原始高风险项包括：
1. SSE provider 错误、坏 JSON、异常 EOF、缺少 `[DONE]` 和空结果判定；
2. 截图 OCR session ID 贯穿取图、OCR、完成和取消；
3. Alt+R 错误事件与 OCR 文本事件分离；
4. 按 webview scope 隔离请求取消；
5. 配置/凭据相关状态回滚、TM 写失败可观察、历史和剪贴板顺序；
6. readiness 注册顺序、失败清理和窗口 readiness 超时；
7. release gate、命令清单同步和相关文档统计。


> **修复状态（当前工作树）**：P1 SSE、OCR session、Alt+R replacement 事件已修复；P2 请求 scope、配置回滚、TM/历史/剪贴板竞态、readiness 和发布 gate 已修复或加固。P3 取消错误、LIKE 转义、SRT 空块、复制反馈和版本前缀已修复。Windows 本地代码门禁已通过；剩余风险集中在真实 Windows 原生集成、Credential Manager 异常和远程 CI/release 运行证据。
---

## 2. 严重度说明

- **P1 / 高**：会导致错误结果、数据错误、跨会话污染或用户可感知的核心功能失败，建议优先修复。
- **P2 / 中**：在并发、异常环境或特定系统集成场景下会导致功能错误或数据不一致。
- **P3 / 低**：边界行为、协议质量、工具链或发布维护问题，影响范围较小但应修正。

---

# 3. Findings


> 以下各条记录的是修复前的 confirmed bug 及其证据，保留用于审查追踪。当前是否仍存在，以本文件顶部“修复状态”和源码/测试证据为准。
代码证据中的行号对应修复前快照；当前源码位置和是否仍存在，以本文件顶部状态、当前文件内容及测试结果为准。
## P1-01：SSE 流中的 provider 错误可能被静默当成成功结果

**触发条件**

兼容 OpenAI 的服务返回 HTTP 200，但在 SSE 流中发送 provider 错误，例如：

```text
data: {"error":{"message":"..."}}
```

或者服务在只返回部分内容、未发送 `[DONE]` 的情况下直接关闭连接。

**代码证据**

- `src-tauri/src/translate.rs:911-943`
  - `process_sse_line` 只尝试解析 `StreamChunk`。
  - JSON 解析失败、没有 `choices` 或没有文本内容时直接返回 `Ok(false)`，不会报告错误。
- `src-tauri/src/translate.rs:1028-1040`
  - 流结束后，即使没有收到 `[DONE]`，也会返回 `Ok(full_text)`。
  - 最后一行的解析结果被显式忽略：`let _ = process_sse_line(...)`。
- `src-tauri/src/commands/translate.rs:197-206`
  - 命令会继续发送 `translate-stream-done`，并将结果写入 TM 和历史记录。

**影响**

- 空结果或部分译文可能被显示为“翻译完成”；
- provider 的真实错误不会展示给用户；
- 错误或不完整结果可能写入翻译记忆和历史；
- 前端无法区分“正常结束”和“异常 EOF”。

**修复方向**

显式解析 SSE error envelope；对无法解析的 `data:` 行、无有效译文、异常 EOF 和缺少 `[DONE]` 的情况返回结构化错误，并禁止将不完整结果写入 TM/历史。

**测试缺口**

修复前没有覆盖 `process_sse_line` 的 provider error、异常 JSON、空 choices、异常 EOF、部分结果和缺少 `[DONE]` 场景；当前已有对应 Rust 回归。

---

## P1-02：截图 OCR 的旧会话可能完成或取消新会话

**触发条件**

用户在 OCR 请求尚未完成时取消当前截图并快速开始下一次截图，或者旧的 `finish_ocr`/`cancel_screenshot` 调用在新会话已经开始后才到达后端。

**代码证据**

- `src-tauri/src/ocr.rs:52-64`
  - 后端维护了带 ID 的 `ScreenshotSession`。
- `src-tauri/src/ocr.rs:76-98`
  - 只有 `store(session_id, ...)` 校验 session ID。
- `src-tauri/src/commands/screenshot.rs:75-91`
  - `run_ocr_on_crop` 不接收 session ID，只读取当前共享的 `image`。
- `src-tauri/src/commands/screenshot.rs:146-160`
  - `finish_ocr` 不接收 session ID，直接完成当前会话。
- `src-tauri/src/commands/screenshot.rs:136-149`
  - `cancel_screenshot` 同样无条件取消当前会话。
- `src/ScreenshotOverlay.tsx:176-192`
  - 前端在本地保存 `sessionRef`，但本地检查和后端 `finishOcr` 调用不是原子操作。
- `src/services/tauriBridge.ts:44-57`
  - `RunOcrOnCropRequest` 与 `FinishOcrRequest` 均没有 session ID 字段。

**影响**

旧 OCR 请求可能：

- 读取或使用新截图会话的图像；
- 调用 `finish_ocr` 清理新会话的缓冲区；
- 关闭新会话的截图窗口；
- 用旧截图文本打开快速翻译窗口；
- 调用取消命令而取消用户当前的新截图。

前端 `sessionRef` 只能阻止部分 UI 更新，无法保护后端的共享状态。

**修复方向**

将后端 session ID 贯穿截图 payload、OCR、完成和取消命令；后端在修改/完成缓冲区时原子校验该 ID。前端也应对截图 payload 加入 generation 校验，避免旧的异步加载覆盖新的图像。

**测试缺口**

修复前已有“同一时间只能有一个会话”和“取消后旧 capture 不能 store”测试，但没有覆盖旧 OCR 请求与新会话交错完成；当前已有 stale-session 和 image lookup 回归，真实 Windows OCR/窗口生命周期仍未覆盖。

---

## P1-03：Alt+R 翻译失败会被当成 OCR 文本再次翻译

**触发条件**

Alt+R 已复制选中文本，但翻译 API 请求失败。

**代码证据**

- `src-tauri/src/setup/shortcuts.rs:489-493`

```rust
w.emit("ocr-translate", format!("❌ Alt+R 失败: {}", e));
```

- `src/hooks/useTauriEvents.ts:86-88`
  - 所有 `ocr-translate` 事件都转给 `onOcrTranslate`。
- `src/features/MainWindowApp.tsx:71-77`
  - `onOcrTranslate` 清空输入后调用 `doTranslateStream(text)`。

**影响**

例如 API Key 失效时，下面这段错误会被当成新的原文再次提交：

```text
❌ Alt+R 失败: API Key 无效或已过期
```

后果包括：

- 真正的 Alt+R 错误被掩盖；
- 额外消耗一次翻译 API 请求；
- 错误信息可能被发送给第三方翻译服务；
- 主窗口可能显示错误文本的翻译，而不是替换失败原因。

**修复方向**

为 Alt+R 使用独立的错误事件，或将事件统一为结构化 payload，例如：

```ts
{ type: "error", message: "..." }
```

错误事件不得复用 `ocr-translate` 文本通道。

---

## P2-01：主窗口、快速窗口和批量翻译共享全局请求序列

**触发条件**

两个翻译流程重叠，例如主窗口正在流式翻译时触发 Alt+Q，或快速翻译窗口正在翻译时主窗口开始新请求。

**代码证据**

- `src-tauri/src/translate.rs:197-210`
  - `ApiConfig` 只有一个通用 `request_seq`。
- `src-tauri/src/commands/translate.rs:52-60`
  - `translate` 递增该序列。
- `src-tauri/src/commands/translate.rs:114-121`
  - `translate_stream` 递增同一个序列。
- `src-tauri/src/commands/translate.rs:257-284`
  - `translate_batch` 也递增同一个序列。
- `src/hooks/useTranslation.ts:118-140`
  - 主窗口调用 `translateStream`。
- `src/features/QuickTranslateWindow.tsx:43-61`
  - 快速窗口也调用 `translateStream`。

**影响**

后端将后发的另一个窗口请求视为“更新请求”，使先发请求失效：

- 主窗口翻译可能被 Alt+Q/快速窗口请求取消；
- 快速窗口翻译可能被主窗口请求取消；
- `cancel_translation` 不能只取消发起该命令的窗口请求。

当前前端为各窗口维护独立的 `requestId`，因此窗口之间的请求身份并未真正隔离。若产品明确要求全应用同一时间只能有一个翻译，应在 UI 和协议中明确；否则应拆分取消域。

**修复方向**

按窗口/工作流拆分后端取消序列，或使用带 request scope 的取消令牌；`cancel_translation` 应携带目标窗口或请求域。

---

## P2-02：配置保存失败后，运行时状态、前端状态和磁盘状态可能不一致

**代码证据**

- `src-tauri/src/commands/config.rs:49-61`
  - API Key、Base URL、模型在保存前先修改内存。
  - API Key 凭据保存失败有局部回滚，但随后配置文件保存失败时 Base URL/模型仍可能保留新值。
- `src-tauri/src/commands/config.rs:65-90`
  - 术语表保存失败时没有恢复旧内存值。
  - 快捷键保存失败时，如果注册成功但磁盘保存失败，也没有恢复旧配置/旧注册状态。
- `src-tauri/src/commands/config.rs:93-115`
  - `set_max_records` 先修改 `ApiConfig.max_records`，保存失败后提前返回，`HistoryStore` 不会同步更新。
- `src-tauri/src/translate.rs:410-414`
  - 免费翻译开关先修改，再持久化。
- `src-tauri/src/translate.rs:445-479`
  - Profile 新增、删除和应用都先修改内存，再保存。
- `src-tauri/src/translate.rs:357-395`
  - `CONFIG_FILE_LOCK` 只保护保存过程，不能回滚调用方之前的内存修改。

**影响**

在配置目录不可写、磁盘空间不足或文件替换失败时可能出现：

- IPC 返回“保存失败”，但本次运行已经使用新配置；
- React 层仍显示旧值，Rust 后端使用新值；
- 重启后从磁盘恢复旧配置，造成行为反复；
- `ApiConfig` 与 `HistoryStore` 使用不同的历史上限；
- 快捷键已在系统注册，但磁盘配置没有保存。

此外，`src-tauri/src/translate.rs:275-302` 将配置文件损坏和文件不存在都按默认配置处理，`src-tauri/src/translate.rs:332-336` 可能随后覆盖原有损坏文件，导致原始配置进一步丢失。

**修复方向**

采用“生成候选状态 → 成功持久化 → 提交内存状态”的事务式流程，或为所有失败路径保存并恢复完整快照。配置文件损坏时应备份原文件并提示用户，而不是静默按默认配置覆盖。

---

## P2-03：TM 和历史搜索存在旧请求覆盖新请求的竞态

### TM 搜索

**代码证据**

- `src/features/TmPanel.tsx:24-27`
  - `loadEntries` 没有请求序列或 query 校验。
- `src/features/TmPanel.tsx:34-41`
  - 防抖只能取消尚未启动的 timer，不能取消已经发出的 IPC。
- `src/features/TmPanel.tsx:46-57`
  - 删除/清空后的刷新也可能与新的查询请求并发。

### 历史搜索

**代码证据**

- `src/layouts/MainLayout.tsx:103-106`
  - `loadHistory` 直接用返回值更新列表。
- `src/layouts/MainLayout.tsx:144-148`
  - 搜索使用防抖，但没有保护已经发出的旧请求。
- `src/layouts/MainLayout.tsx:269-270`
  - 删除和清空后的刷新没有请求身份校验。

**触发条件**

用户快速输入多个查询词，例如：

```text
a → ab → abc
```

如果 `abc` 请求先返回而 `a` 请求后返回，旧结果会覆盖新结果。

**影响**

- 列表内容与搜索框不一致；
- 删除后的条目可能被旧查询结果重新显示；
- 导入、清空、删除和搜索并发时 UI 状态不可预测。

**修复方向**

为每次查询/刷新分配 generation 或 request ID，只允许最新请求更新状态。删除、导入和清空也应使旧查询失效。

**测试缺口**

未发现 `TmPanel` 或历史面板针对乱序响应、删除后刷新和搜索并发的测试。

---

## P2-04：剪贴板写入失败时仍被标记为“本应用内容”

**代码证据**

- `src-tauri/src/commands/clipboard.rs:33-42`

```rust
guard.mark_written(&text);
app.clipboard().write_text(text)
```

- `src-tauri/src/clipboard.rs:247-277`
  - 剪贴板监听根据 hash 判断是否为本应用写入。

**影响**

如果实际写入剪贴板失败，`ClipboardGuard` 仍保存目标文本 hash。之后用户从其他应用复制相同文本时，监听器可能将其误认为本应用写入并跳过翻译。

**修复方向**

只有 `write_text` 成功后才调用 `mark_written`；失败时不要设置 dirty/hash，必要时清理之前的本应用标记。

---

## P2-05：富剪贴板内容无法完整恢复时，可能遗留临时选中文本

**触发条件**

用户原剪贴板只有图片或其他未被当前 native snapshot 支持的格式，然后执行 Alt+Q/Alt+R 的剪贴板复制流程。

**代码证据**

- `src-tauri/src/clipboard.rs:56-60`
  - 过滤部分需要特殊句柄处理的格式。
- `src-tauri/src/clipboard.rs:63-113`
  - 只备份可复制的全局格式。
- `src-tauri/src/clipboard.rs:130-141`
  - 原剪贴板没有文本但并非真正为空、且 native 恢复失败时直接返回失败。
- `src-tauri/src/keyboard.rs:380-386`
  - 复制流程调用恢复，但恢复失败后仍继续返回捕获到的文本。

**影响**

原有富格式剪贴板内容无法恢复时，临时复制的选中文本可能留在用户剪贴板中，造成用户剪贴板内容丢失。

**修复方向**

完整支持需要恢复的格式，或在恢复失败时明确清理临时内容并通知用户；不要静默继续完成流程。

**测试缺口**

缺少真实 Windows 图片剪贴板、富文本、延迟渲染格式以及恢复失败的集成测试。

---

## P2-06：前端 readiness 标志可能早于全部事件监听器注册

**代码证据**

- `src/hooks/useTauriEvents.ts:78-129`
  - 监听器逐个异步注册。
- `src/hooks/useTauriEvents.ts:131-137`
  - `setup()` 启动后没有等待完整注册。
- `src/features/MainWindowApp.tsx:102-114`
  - 另一个 effect 很快调用 `frontendReady()`。
- `src-tauri/src/commands/app.rs:9-26`
  - readiness 使用全局静态原子变量，且不会随窗口 reload 重置。
- `src-tauri/src/setup/shortcuts.rs:232-245`
  - 后端在 ready 后重新发送快捷键冲突事件。
- `src-tauri/src/commands/window.rs:89-119`
  - 窗口事件最多等待 500ms，之后仍会发送。

**影响**

启动、窗口 reload 或事件监听重建期间，一次性事件可能在监听器安装前发出并丢失，例如：

- `expand-main-window`；
- `toggle-main-window`；
- `shortcut-registration-conflicts`；
- 快捷键/截图相关事件。

永久的全局 ready 标志还会使后端误以为某个窗口的监听器仍然有效。

**修复方向**

在全部监听器注册成功后再设置 ready；或者改用可重放状态、带序列号的事件或命令式握手，避免依赖一次性全局事件。

---

## P2-07：SRT 空字幕块会从输出中消失

**代码证据**

- `src/lib/fileParser.ts:31-35`
  - 只有 `text` 非空时才加入 `blocks`。
- `src/lib/fileParser.ts:41-45`
  - 重建时只输出已解析的 blocks。
- `src/hooks/useFileTranslation.ts:79-94`
  - 翻译结果直接根据解析后的 blocks 重组。

**影响**

输入包含合法但空文本的字幕块时，该块的序号和时间轴会被删除，输出 SRT 结构发生变化。现有测试在 `src/lib/fileParser.test.ts` 中将跳过空块视为预期行为，但对于文件翻译而言这会造成结构数据丢失。

**修复方向**

保留空字幕块及其时间码；只对非空文本生成翻译段，并在重建时按原始 block 顺序写回。

---

## P2-08：版本发布 workflow 没有真正等待 CI 成功

**代码证据**

- `.github/workflows/ci.yml:3-7`
  - main 分支 push 会启动 CI。
- `.github/workflows/version-bump.yml:27-43`
  - 版本 bump 后先 push 分支，再立即 push tag。
- `.github/workflows/release.yml:48-51`
  - release workflow 只注释说明 tag 已通过 CI，并没有实际检查 CI 状态。

**影响**

版本 bump 后可能发生：

1. 分支 push 触发 CI；
2. version-bump workflow 立即 push tag；
3. tag 触发 release 构建；
4. CI 尚未完成，或最终失败，但 release 仍继续构建并发布安装包。

因此可能发布未经测试、Clippy 或构建门禁验证的安装包。

**修复方向**

让 release 构建成为 CI 成功后的依赖 job，或使用 `workflow_run`/GitHub API 等方式确认目标 commit 的 CI 已成功后再创建 tag。

---

# 4. P3 / 低优先级和边界问题

## P3-01：Unicode 字符计数口径不一致

- `src/features/translate/InputSection.tsx:51,85,97`
  - 使用 `inputText.length`，按 UTF-16 code unit 计数。
- `src/lib/textUtils.ts:9-10`
  - 使用 `Array.from(text).length`。
- `src-tauri/src/translate.rs:568-574`
  - 使用 Rust `text.chars().count()`。

例如一个非 BMP emoji 通常在 JavaScript `length` 中计为 2，但在 `Array.from` 和 Rust `chars().count()` 中计为 1。结果是 UI 计数、HTML `maxLength` 和后端限制不一致，用户粘贴大量 emoji 时尤为明显。

建议统一产品所采用的“字符”定义，并在输入计数、限制、文件检查和后端校验中使用同一口径。

## P3-02：拖拽文件在读取完成前没有文件大小限制

- `src/features/translate/FileDropZone.tsx:51-62`
  - 直接使用 `FileReader.readAsText(file)`。
- `src/hooks/useFileTranslation.ts:48-54,120-128`
  - 完整读入字符串后才检查字符数。

超大文件会先进入 WebView 内存并可能造成 UI/内存压力，之后才被拒绝。TM 导入已经有 10MB 限制，但普通文件拖拽没有同等的字节数预检查。

建议在 `FileReader` 前按 `file.size` 设置合理上限，并在读取过程中处理读取取消和异常。

## P3-03：历史记录启动加载时不立即应用 `max_records`

- `src-tauri/src/history.rs:29-43`
  - 加载 `history.json` 时保留全部记录。
- `src-tauri/src/history.rs:45-53`
  - 只有显式调用 `set_max_records` 时才裁剪现有记录。
- `src-tauri/src/history.rs:71-80`
  - 新增记录时才执行上限裁剪。

旧版本留下大量记录，或历史上限被降低后，应用启动时仍会显示和保留超出当前上限的记录。建议加载时立即裁剪并标记 dirty，或在首次启动后持久化裁剪结果。

## P3-04：历史记录复制成功提示早于实际写入结果

> **状态：已修复。** `HistoryPanel` 现在等待 `writeClipboardSafe()` 成功后才显示复制反馈，并处理失败。

- `src/features/HistoryPanel.tsx:37-40`
  - `onCopy` 返回前就设置 copied 状态。
- `src/layouts/MainLayout.tsx:263-270`
  - 传入的 `writeClipboardSafe` Promise 未被等待或捕获。

剪贴板写入失败时，界面仍可能短暂显示复制成功。建议让 `onCopy` 返回 `Promise<void>`，成功后再更新提示，并在失败时显示错误。

## P3-05：流式取消错误被包装成 `API` 而不是 `CANCELLED`

> **状态：已修复。** `map_translation_error()` 将稳定的 `CANCELLED` 映射为 `CommandError::cancelled()`。

- `src-tauri/src/translate.rs:1000-1004`
  - 流中取消返回字符串 `"CANCELLED"`。
- `src-tauri/src/commands/translate.rs:170-191`
  - 通过 `CommandError::api` 包装所有底层字符串错误。
- `src/lib/errors.ts:33-35`
  - 前端只能额外依靠 `message === "CANCELLED"` 兼容。

实际返回可能是：

```json
{"code":"API","message":"CANCELLED"}
```

而不是声明的 `CANCELLED` 错误码。当前前端可以识别，但其他调用方可能将取消误判为 API 失败。建议在 Rust 中直接构造 `CommandError::cancelled()`。

## P3-06：TM 搜索词中的 `%` 和 `_` 被当作 SQL 通配符

> **状态：已修复。** TM 查询已使用 `ESCAPE '!'` 并转义 `%`、`_` 和 `!`。

- `src-tauri/src/tm.rs:224-245`

用户搜索 `%` 或 `_` 时，查询会将其作为 SQLite `LIKE` 通配符，而不是字面量。搜索框没有说明支持通配符，因此可能得到过宽的结果。建议转义 `LIKE` 特殊字符并指定 `ESCAPE`，或者明确提供通配符语义。

## P3-07：带 `v` 的版本输入可能生成 `vv...` tag

> **状态：已修复。** workflow 和脚本都会去除 `v` 前缀；tag 创建前等待同一 commit 的 CI。

- `scripts/bump-version.mjs:16-18`
  - 接受带 `v` 的输入并去掉前缀。
- `.github/workflows/version-bump.yml:34-43`
  - 使用未经规范化的原始输入创建 tag。

输入 `v0.2.0` 时：

- manifest 写入 `0.2.0`；
- workflow 创建 `vv0.2.0`。

workflow 描述要求“不带 v”，但脚本明确接受带 `v` 的输入，二者契约不一致。建议在 workflow 中统一规范化版本号，或让脚本严格拒绝带 `v` 的输入。

---

# 5. 剩余测试盲区

> 以下是当前仍未由真实 Windows/跨窗口/远程 CI 证据覆盖的路径；修复前的缺陷描述仍保留在第 3 节，不能据此推断这些缺陷仍存在。

1. **SSE 与翻译持久化集成**
   - provider/坏 JSON/空 choices/异常 EOF/缺少 `[DONE]` 已有 Rust 回归；尚缺真实 HTTP provider 到命令层的集成验证。
   - TM 写入失败已有 SQLite trigger 回归；尚缺命令层历史与 UI 行为的集成验证。
2. **截图 OCR**
   - stale session、图像取图绑定和完成/取消校验已有 Rust 回归；尚缺真实 Windows OCR、窗口复用和关闭时序。
   - 多显示器、负坐标和混合 DPI 仍需 Windows 集成验证。
3. **多窗口翻译**
   - request scope 已有单元回归；主窗口、快速窗口、批量翻译的真实并发仍需集成测试。
4. **配置持久化**
   - 文件写入/替换失败和内存回滚已有回归；API Credential Manager 写入失败仍缺 Windows 测试。
   - 并发保存队列已有前端测试，后端跨进程并发仍未验证。
5. **TM/历史 UI**
   - 乱序查询 generation、删除/清空/导入与搜索并发仍缺端到端测试。
6. **剪贴板和快捷键**
   - guard 顺序和富格式失败回退已有单元覆盖；图片、延迟渲染格式、UI Automation 和真实 SendInput 仍需 Windows 测试。
7. **发布流程**
   - `v` 前缀和 CI gate 已在脚本/workflow 中修正；尚无真实 GitHub Actions run 验证。
---

# 6. 验证结果

已完成以下只读验证：

- TypeScript `pnpm tsc --noEmit` 通过；生产 TS 无直接 `invoke()` 和 `any`；
- `eslint src --no-warn-ignored`：通过；此前一次外层 lint 包装命令曾异常退出，已与正式命令区分；
- Windows `cmd.exe` 执行 `pnpm tauri build`：Vite 转换 2234 个模块，Rust `0.1.1` release 和 NSIS installer 均成功，生成 `VanishTrans_0.1.1_x64-setup.exe`；
- Rust `cargo fmt --check` 通过；
- Rust Clippy `--all-targets -- -D warnings` 通过；
- Rust 测试：91 个全部通过；
- 前端清单：19 个测试文件、165 个参数展开测试；Windows `pnpm check` 已验证 19/19 文件、165/165 通过；App、ScreenshotOverlay、QuickTranslateWindow、BallWindow、Bridge、useConfig、useFileTranslation、useTauriEvents 等关键路径均包含回归；WSL 多文件 runner 仍有环境稳定性问题；
- `node scripts/check-tauri-commands.mjs`：52 个注册命令与两份文档清单一致。

本地 WSL 环境的 `PATH` 中没有 `cargo`，验证时使用已安装的 Windows Rust 工具链：

```text
/mnt/c/Users/Wang/.cargo/bin/cargo.exe
```

这与 CI 使用的 Windows runner 环境一致。另有一次外层 lint 包装命令错误地扫描了 `scripts/bump-version.mjs`，产生 Node `process`/`console` 的 `no-undef`；仓库实际定义的 `eslint src` 已单独验证通过。

---

# 7. 文档和工作区状态

## 7.1 测试文档过时

`docs/testing/TESTING_SUMMARY.md` 的旧统计已更新为当前清单；当前事实为：
- Windows `pnpm check` 已通过 19 个前端测试文件、165 个参数展开测试；WSL 多文件 runner 的失败不作为代码门禁证据；
- 91 个 Rust 测试全部通过。

相关位置：

- `docs/testing/TESTING_SUMMARY.md:12-18`；
- `docs/testing/TESTING_SUMMARY.md:143-162`；
- `docs/testing/TESTING_SUMMARY.md:286-300`。

这是文档准确性问题，不是运行时 bug。

## 7.2 工作区存在换行符污染

审查时工作区显示有 41 个修改文件，但：

- `git diff --ignore-space-at-eol --quiet` 表明没有语义差异；
- 主要变化是 LF/CRLF 转换；
- `git diff --check` 因 CRLF 被识别为 trailing whitespace 而失败；
- `git ls-files --eol` 显示 61 个跟踪文件为 CRLF 或 mixed。

这会降低 diff 的可审阅性并增加后续合并风险，但不应被误判为业务代码行为变化。本次没有清理这些换行符。

## 7.3 未直接判定为 bug 的观察项

以下事项已检查，但当前证据不足以作为确定性缺陷报告：

- 缺少 single-instance 插件：产品是否要求单实例尚未在 README/配置中明确；
- Windows `std::fs::rename` 覆盖配置文件：当前没有足够证据证明其在目标环境中必然失败；
- 直接使用 Tauri `listen`/`emit`；
- 使用 Tauri 剪贴板插件本身；
- 主题监听采用异步注册本身。

---

# 8. 剩余工作建议

1. 补做真实 Windows OCR、剪贴板/富格式恢复、Credential Manager、跨窗口并发和 installer 安装后 smoke test；Windows 本地 `pnpm check` 与未安装版 exe 启动 smoke 已通过；
2. 增加 TM/历史 UI 的删除、清空、导入与搜索乱序集成测试；
3. 为 52 个 bridge 命令补齐一致的 Request/Response 类型模型，或明确以 wrapper 返回类型为正式契约；
4. 对 `useBallWindow.ts`、`translate.rs`、`setup/shortcuts.rs` 等超大文件增加拆分或自动化行数检查；
5. 在可用的 GitHub Actions 环境执行 version bump、CI gate 和 release dispatch 的真实演练；
6. 持续保持文档中的测试数字、构建证据和 Production Ready 判定与实际运行结果一致。
