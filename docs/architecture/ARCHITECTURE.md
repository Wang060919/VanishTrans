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
| 原生窗口过渡 | `src/features/ball/useBallTransitions.ts` 调度；`src/features/ball/ballTransition.ts` 执行 |
| 尺寸与停靠 | `src/features/ball/ballGeometry.ts` 测量展开位置；`src/features/ball/ballCollapse.ts` 收起 |
| 拖动与窗口事件 | `src/features/ball/useBallDrag.ts`、`src/features/ball/useBallFullPosition.ts`、`src/features/ball/useBallEvents.ts` |
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

本次拆分覆盖翻译核心、悬浮窗和前端翻译会话。`src-tauri/src/setup/shortcuts.rs`、`src-tauri/src/tm.rs`、
`src-tauri/src/ocr.rs` 等仍有超过行数约束的存量文件；桥接文件也仍略超既有例外预算。
这属于后续维护债务，不代表全仓已满足行数约束。按职责边界逐步处理，不为压缩行数合并语句。
