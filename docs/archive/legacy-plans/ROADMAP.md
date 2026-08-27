# VanishTrans 路线图

> 本文件是唯一可信的路线图与状态台账。仓库内其他 `docs/plans/*` 为历史归档，
> 以本文件为准；如有冲突，以代码和本文件为准。

更新时间：2026-08-07

## 总体判断

VanishTrans 当前属于“功能较完整、可构建的 beta”。核心翻译链路与测试基础
良好（Rust 75 测试、前端 101 测试全绿），主要欠账集中在真实 Windows 交互安全、
失败处理、交付流程与文档一致性。以下按阶段列出状态与待办。

## 阶段 1：稳定性止血（2–3 天）

目标：消除会导致错误窗口粘贴、启动失败、静默丢数据的高风险问题。

| 项目 | 状态 | 说明 |
|---|---|---|
| Alt+R 目标窗口校验与剪贴板恢复 | ✅ 完成 | 记录起始前台窗口，写入/粘贴前后校验焦点，粘贴后恢复用户剪贴板，任一步失败即中止 |
| 快捷键冲突降级 | ✅ 完成 | 注册冲突不再整体回滚；可用项照常注册，冲突项通过 `shortcut-registration-conflicts` 通知前端 |
| TM 初始化失败降级 | ✅ 完成 | 持久库打不开时使用内存模式，翻译仍可用，并向前端推送启动警告 |
| 历史保存错误处理 | ✅ 完成 | `flush/delete/clear` 返回错误，保存失败回滚并保持脏标记以便重试 |
| 日志链路 | ✅ 完成 | 新增 `logging.rs`，文件轮转 5MB，OCR 原文预览已移除，不记录敏感文本 |
| 术语编辑防抖丢失 | ✅ 完成 | 设置面板关闭时刷新未落盘的防抖编辑 |
| 错误协议 | ✅ 完成 | 前端 `normalizeTranslationRequest` 区分文本/错误事件，不再把 `ERROR:` 当协议字段 |
| 请求重入 | ✅ 完成 | 加载中 Enter/按钮不会发起重复请求 |
| 截图加载失败卡死 | ✅ 完成 | 加载失败展示可点击重试的错误状态 |
| CSV 公式注入 | ✅ 完成 | 导出转义 `= + - @` 前缀，导入还原 |
| 剪贴板监听关闭后误触发 | ✅ 完成 | 休眠后重新检查开关再读取剪贴板 |

## 阶段 2：质量与发布基线（2–3 天）

目标：自动门禁全绿、可生成安装包、文档与行为一致。

| 项目 | 状态 | 说明 |
|---|---|---|
| `cargo fmt --check` | ✅ 完成 | 全仓格式化通过 |
| 严格 Clippy（`-D warnings`） | ✅ 完成 | 0 警告 |
| Rust 测试 | ✅ 完成 | 75/75 通过 |
| 前端测试 | ✅ 完成 | 101/101 通过 |
| 统一 `check` 脚本 | ✅ 完成 | `pnpm check`（typecheck+测试）、`pnpm check:rust`（fmt+clippy+test） |
| 前端 lint | ✅ 完成 | ESLint flat config + typescript-eslint + react-hooks 经典规则，纳入 `pnpm check` 与 CI |
| Windows CI | ✅ 完成 | `.github/workflows/ci.yml`：前端/Rust 门禁 + Tauri 安装包构建 |
| 发布自动化 | ✅ 完成 | `.github/workflows/version-bump.yml`（手动触发 bump 版本+打 tag）→ `.github/workflows/release.yml`（tag 触发构建安装包并发布 GitHub Release）；本地可 `pnpm bump 0.2.0` |
| 锁定 Node/pnpm/Rust | ✅ 完成 | `engines`、`packageManager`、`.nvmrc`、`rust-toolchain.toml` |
| LICENSE | ✅ 完成 | MIT，版权 2026 Wang060919 |
| NSIS 安装包配置 | ✅ 完成 | `tauri.conf.json` bundle 已配置；MSI 需安装 WiX 后可启用 |
| 原生 smoke 清单 | ✅ 完成 | 见 [SMOKE_TEST.md](SMOKE_TEST.md) |
| README 一致性 | ✅ 完成 | 深色主题、JSON 历史、Node 版本、项目结构已校正 |

## 阶段 3：架构与数据收口（4–6 天）

目标：降低单文件规模与耦合，强化失败可见性与数据原子性。

| 项目 | 状态 | 说明 |
|---|---|---|
| 拆分大文件 | ✅ 完成 | `commands.rs`（~950 行）→ `commands/` 8 个领域模块；`BallWindow.tsx`（~880 行）→ `useBallWindow.ts` hook + 渲染壳（~50 行）；`index.css`（~1900 行）→ `styles/` 5 个文件 |
| 结构化错误 | ✅ 完成 | 后端 `CommandError { code, message }`，全部命令返回结构化错误；前端 `errorMessage/errorCode` 统一解析，兼容字符串/对象/Error |
| 按工作流取消 | ✅ 完成 | 主窗口翻译与 Alt+R 替换使用独立 `request_seq`，互不取消；OCR 已有 session 隔离 |
| 原子持久化 | ✅ 完成 | 历史与配置（含灵动岛位置）均原子写入（tmp+rename）；TM 使用 SQLite WAL |
| 带配置版本的 TM | ✅ 完成 | `context_hash` 覆盖 base_url/model/glossary，改配置即隔离旧缓存；哈希改用稳定 FNV-1a，升级不失效 |

## 阶段 4：产品增量（下一迭代）

目标：围绕可用性与隐私控制做增量，不做大重构。

- 服务配置档案（多套 Base URL/Model 快速切换）— ✅ 完成：`save/apply/delete_service_profile` + 设置页档案管理
- 连接测试按钮 — ✅ 完成：`test_connection` 命令 + 设置页"测试连接"
- 强制刷新缓存（绕过 TM）— ✅ 完成：`forceRefresh` 参数 + 翻译面板"忽略缓存"开关
- 历史/隐私控制（清除历史、禁用日志记录）— ✅ 完成：日志开关（`set/get_logging_enabled`）+ 设置页隐私标签
- 暂缓：多引擎对比、滚动截图 OCR

## 完成标准（稳定公开版）

- [ ] 所有自动门禁通过（前端 check、lint、fmt、clippy、Rust 测试、构建）
- [ ] 能生成 NSIS 安装包并通过原生 smoke 清单
- [ ] Windows 核心流程签收：划词翻译、原地替换、截图 OCR、剪贴板监听、托盘
- [ ] 无静默数据丢失（历史/TM/配置写入失败必须可见）
- [ ] README 与实际行为一致，ROADMAP 保持唯一可信

## 工具链版本

| 工具 | 版本 |
|---|---|
| Node.js | >= 20.19（`.nvmrc` 22） |
| pnpm | 10.33.2 |
| Rust | 1.95.0（`rust-toolchain.toml`） |
