# VanishTrans 当前架构

此文描述当前实现。`REFACTORING_SUMMARY.md` 与 `REFACTORING_FINAL.md` 保留历史过程，不是当前结构或验收证明。
工程约束及命令清单以 [根 AGENTS.md](../../AGENTS.md) 为准。

## 从任务找到入口

| 需要修改的行为 | 入口与职责 |
| --- | --- |
| 主窗口翻译流程 | `src/hooks/useTranslation.ts` 组合文本、文件操作及方向选择 |
| 结果、错误、取消、流式完成 | `src/hooks/useTranslationSession.ts` 唯一维护该窗口的翻译会话 |
| 请求身份 | `src/lib/translationState.ts` 定义进行中、完成、失效请求的规则 |
| 文本及流式请求 | `src/hooks/useTextTranslation.ts` 清理输入、调用 IPC、提交结果 |
| 文件翻译 | `src/hooks/useFileTranslation.ts` 批处理及回退；`src/lib/translationFile.ts` 解析与重组 |
| 迷你窗口事件 | `src/hooks/useQuickTranslation.ts` 注册监听、报告就绪；复用相同翻译会话 |
| 悬浮窗组合 | `src/features/useBallWindow.ts` 连接状态、过渡、操作、拖动与事件 |
| 悬浮窗同步状态 | `src/features/ball/useBallState.ts` 维护渲染状态及异步回调使用的 refs |
| 原生窗口过渡 | `src/features/ball/useBallTransitions.ts` 调度；`src/features/ball/ballTransition.ts` 执行；`src/features/ball/ballRollback.ts` 失败回滚 |
| 尺寸与停靠 | `src/features/ball/ballGeometry.ts` 测量展开位置；`src/features/ball/ballCollapse.ts` 收起 |
| 拖动与窗口事件 | `src/features/ball/useBallDrag.ts`、`src/features/ball/ballPointer.ts`、`src/features/ball/useBallFullPosition.ts`、`src/features/ball/useBallEvents.ts`;`ballSnap.ts` 处理松手边缘吸附判定与归位动画 |
| 原生调用边界 | `src/services/tauriBridge.ts` 是命令 IPC 入口；Tauri 事件与窗口 API 保留在对应适配层 |
| 后端翻译入口 | `src-tauri/src/commands/translate.rs` 验证请求身份、访问缓存、提交 TM/历史 |
| 翻译路由与取消 | `src-tauri/src/translate.rs` 选择提供商，按窗口取消请求 |
| API 请求构造 | `src-tauri/src/translate/request.rs` 校验配置、构造提示词和请求体 |
| 提供商与协议 | `src-tauri/src/translate/completion.rs`、`src-tauri/src/translate/google.rs`、`src-tauri/src/translate/streaming.rs` |
| 流内容解析 | `src-tauri/src/translate/sse.rs` 只处理 SSE 内容，传输超时由 streaming 模块负责 |
| 配置及凭据 | `src-tauri/src/config/` 分开维护载入、保存、凭据、档案、上下文指纹和请求序号 |

## 请求生命周期

```text
主窗口 useTranslation ── 文本/文件操作 ─┐
                                    ├─ 各自窗口的 useTranslationSession ─ tauriBridge
迷你窗口 useQuickTranslation ─ 文本操作 ┘                                   │
                                                 commands/translate.rs ◄──┘
                                                    │        │
                                              translate.rs   TM / history
                                                    │
                                                provider modules
```

- 每个窗口只有一个会话，主窗口和迷你窗口互不取消。主窗口的文本、流式、文件翻译共享请求序号。
- `begin` 同步失效旧请求，清理旧错误、文件状态与完成定时器。操作开始时固定翻译方向，回退不读取后来切换的方向。
- chunk 只接受当前且未结束的请求。done 事件和 IPC 返回都携带完整译文，经同一个 `complete` 提交一次。
- 取消、重置、卸载立即使旧请求失效；旧请求的结果、错误、chunk 和定时器不能修改新会话。
- 文件操作不直接设置 loading/output/error，不自行创建第二套请求 ID。解析与重组纯函数不访问 IPC。
- 后端按 webview label 隔离请求序号。检查当前请求和提交 TM/历史共用序号锁；Alt+R 使用独立序号域。
- 配置写入串行化，保存失败恢复内存快照；凭据与普通配置文件分开保存。缓存按配置指纹隔离。
- 每次翻译在配置写锁下捕获不可变快照，提供商路由、URL/凭据、模型、术语表及缓存指纹共用该快照；批处理的所有分段也复用它。
- 配置与历史载入区分文件不存在、解析失败和读取失败。解析失败须先完整备份原始字节；读取或备份失败时，本次运行禁止覆盖该存储，并通过启动告警提示。球位置保存也使用统一配置写入入口。
- 流式 HTTP 错误响应体读取同样受取消、超时及大小限制约束；非流式空白译文不得提交 TM/历史。
- TM CSV 导出采用 `vanishtrans-csv-v2`（追加 `context_hash`、`created_at`、`hit_count` 列），回导入按行恢复上下文并以 `created_at` 保证不会覆盖更新的条目；`vanishtrans-csv-v1` 与无标记文件仍按原文导入——v1 行使用当前上下文指纹并保持文件顺序更新。导入每 500 行提交一次以释放 `tm.conn`，中途失败为部分导入并在错误中说明已提交条数。
- `set_tm_dir` 在配置保存成功后将活动 `TranslationMemory` 连接重指向新目录，无需重启生效。
- `translation-state` 携带会话来源、请求序号和单调 revision。悬浮窗拒绝旧事件，并在任一来源仍工作时保持 working；会话卸载只清理自身来源，不再广播无身份的全局 idle。

## 事件协议

前端→后端只走命令 IPC，无 `listen`；后端→前端按下表 `emit`。带就绪门控的发送要么先等 `FRONTEND_READY`/`QUICK_FRONTEND_READY`（命令内等待），要么经 `emit_to_ball_when_ready`（`src-tauri/src/ball_emit.rs`，`BALL_EMIT_LOCK` 串行，最长 5 s 重试）——原生上下文（托盘、热键、单实例）发出的事件经过后者。

| 事件 | 目标 | 负载 | 主要发出点 | 顺序/门控 |
| --- | --- | --- | --- | --- |
| `shortcut-translate` | `ball` | `String` 或 `{type:"text"|"error",…}` | `show_main_with_text` | `show`→`wait_for_frontend`→emit |
| `clipboard-watch-translate` | `ball` | `String`（清理后剪贴板文本） | `clipboard_watch` 线程 | 发前复查开关与剪贴板去重 |
| `expand-main-window` | `ball` | `()` | 单实例/托盘 pin/`show_main_window`/Alt+R 失败 | 就绪门控；pin 时先 `pinned.fetch_not` 再 emit |
| `toggle-main-window` | `ball` | `()` | 托盘菜单/图标、`toggle_ball_show_main` | 就绪门控 |
| `pin-state-changed` | `ball` | `bool` | `toggle_pin`、托盘 `toggle_top` | `fetch_not(SeqCst)` 后 emit |
| `translate-stream-chunk` | 调用方 label（`ball`/`quick`） | `{requestId,chunk}` | `commands/translate.rs` | 每 chunk 前 `is_current_request` 复查 |
| `translate-stream-done` | 调用方 label | `{requestId,fullText}` | `commands/translate.rs` | `persist_translation` 在 `request_seq` 锁内完成后才 emit；与 IPC 返回先到先提交 |
| `quick-translate` | `quick` | `String`（源文本） | `show_quick_translation*` | `with_current_quick_request` 持锁跨过 position/show/focus/emit |
| `quick-translate-result` | `quick` | `{source,text,requestSeq}` | `show_quick_result`（Alt+R 回退） | 持锁 emit 但不 show/focus；前端 `reveal_quick_result` 才显示 |
| `quick-translate-error` | `quick` | `String` | `show_quick_error` | 先 claim seq→等待就绪→持锁 position/show/focus/emit |
| `screenshot-start` | `ball` | `()` | `start_screenshot` | 在 `prepare_screenshot`/`begin` 成功后才 emit，避免误清岛状态 |
| `screenshot-error` | `ball` | `String` | `start_screenshot` 失败路径、Alt+R 失败 | 经就绪门控或直接 `emit` |
| `screenshot-ready` | `screenshot` | `ScreenshotPayload`（camelCase，含 `sessionId`、`smartRegions`） | `start_screenshot` 覆盖窗就绪后 | `ScreenshotBuffer::store` 成功才 emit；前端按 `sessionId`/`payloadRequestRef` 丢弃过期负载 |
| `shortcut-registration-conflicts` | 广播（`app.emit`） | `Vec<{action,shortcut,error}>` | `publish_shortcut_conflicts` | 未就绪时 5 s 轮询重发 |
| `translation-state` | 广播（前端→前端） | `{state,sourceId,requestId,revision,result?}` | `useTranslationSession` | 悬浮球按 `sourceId`/`revision` 拒绝旧事件；working 不被同 requestId 的 done 复活 |
| `theme-change` | 广播（前端→前端） | `"light"\|"dark"` | `useTheme` | 各窗口 `useThemeSync` 应用 |

## 悬浮窗状态与原生边界

`useBallState` 持有唯一的 mode、presentation 和几何 refs。其他模块用显式字段类型声明需要的状态。
`useBallActions` 处理用户操作，`useBallEvents` 接收业务/焦点事件，两者均向同一个过渡协调器请求目标状态。
协调器负责串行化和过期 generation；异步测量或动画等待后检查 `context.isCurrent()`。
拖动通过协调器暂停队列，结束后恢复；全窗口移动与小窗口拖动各有独立位置处理。
`ballNative` 只包装原生尺寸/位置调用，不持有业务状态。

## 验证与维护边界

- `pnpm check`：当前文档中的源码路径、新拆分模块的行数预算、命令清单、TypeScript、前端测试、ESLint。
- `pnpm check:rust`：Rust 格式、Clippy 与测试。也可使用 `--locked --offline` 分别执行 Cargo 检查。
- 翻译生命周期回归位于 `src/hooks/__tests__/useTranslation.test.ts`；两个窗口及悬浮窗继续由已有组件测试覆盖。
- Rust 测试按配置、语言、Google 响应和 SSE 分组放在对应模块附近；不需要真实 API Key 或联网。
- 自动测试不能替代真实 Windows 窗口拖动、多显示器、快捷键和 OCR 的桌面验收。

本次拆分覆盖翻译核心、悬浮窗和前端翻译会话。`src-tauri/src/setup/shortcuts/`、`src-tauri/src/tm/`、
`src-tauri/src/lib.rs` 等仍有超过行数约束的存量文件；桥接文件也仍略超既有例外预算。
这属于后续维护债务，不代表全仓已满足行数约束。按职责边界逐步处理，不为压缩行数合并语句。
