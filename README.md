<div align="center">

# VanishTrans

**轻量级 AI 驱动的 Windows 翻译工具**

基于 Tauri 2 + React 18 + TypeScript 构建，支持划词翻译、原地替换、截图 OCR 与悬浮岛工作区。

**当前版本：[v0.1.4](https://github.com/Wang060919/VanishTrans/releases/tag/v0.1.4)** · [下载安装包](https://github.com/Wang060919/VanishTrans/releases/download/v0.1.4/VanishTrans_0.1.4_x64-setup.exe) · [下载独立 exe](https://github.com/Wang060919/VanishTrans/releases/download/v0.1.4/vanish-trans.exe)

</div>

---

## 功能特性

### 核心翻译

| 快捷键 | 功能 |
|--------|------|
| `Alt+Q` | **划词翻译** — 选中文本，弹窗显示翻译结果 |
| `Alt+R` | **原地替换** — 验证原选区后替换；无法确认目标时改为显示译文 |
| `Alt+W` | **截图 OCR** — 截屏选取区域，识别文字并翻译 |
| `Ctrl+Enter` | 翻译输入框中的文本；`Enter` 用于换行 |
| 拖拽文件 | 拖入 `.txt` / `.srt` / `.json` 文件自动翻译 |

### 翻译引擎

- **自定义 API** — 支持 OpenAI Chat Completions 格式，配置 Base URL、API Key 和模型名称
- **Google 免费翻译** — 无需 API Key，需要能够连接 Google
- **服务配置** — 保存常用服务地址和模型，选择后点击“应用”切换；配置档案不包含 API Key
- **流式输出** — 逐字显示翻译结果，感知速度更快
- **智能方向** — 自动检测中英文，自动选择翻译方向
- **术语表** — 自定义固定翻译规则（如 "AI" → "人工智能"）

### 翻译记忆 (TM)

- SQLite 本地存储，精确匹配命中时跳过 API 调用
- 自动记录每次翻译，支持搜索、删除、清空
- 导出/导入 CSV 格式

### 桌面悬浮岛

- 桌面常驻胶囊形悬浮岛，单击展开剪贴板翻译、截图 OCR 和完整工作区入口
- 翻译过程中显示状态，完成后可查看、复制译文
- 从结果面板打开完整工作区时，保留原文、译文及翻译方向，无需再次翻译
- 根据屏幕边缘选择展开方向，可拖动移动并保存位置；完整工作区靠近顶部时可吸附
- 按 `Esc` 收起；未置顶的完整工作区失焦时自动收起

### 其他特性

- 🌙 **深色主题** — 当前版本固定深色视觉
- 📋 **剪贴板监听** — 开启后自动翻译复制的文本
- 📜 **翻译历史** — 默认保存最近 200 条记录，支持搜索、删除和清空
- 📌 **窗口置顶** — 固定窗口在最上层
- ⌨️ **自定义快捷键** — 可修改全局快捷键组合
- 🔐 **API Key 安全** — 使用 Windows 凭据管理器存储

---

## 快速开始

### 下载安装

Windows x64 用户可从 [GitHub Releases](https://github.com/Wang060919/VanishTrans/releases/latest) 下载：

- `VanishTrans_0.1.4_x64-setup.exe`：安装包，按提示完成安装。
- `vanish-trans.exe`：独立可执行文件。

安装使用无需 Node.js、pnpm 或 Rust。v0.1.4 的详细更新见[发布说明](docs/releases/v0.1.4.md)。

### 从源码运行：环境要求

- [Node.js](https://nodejs.org/) 20.19+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri 2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

### 从源码运行：安装与启动

```bash
# 克隆仓库
git clone https://github.com/Wang060919/VanishTrans.git
cd VanishTrans

# 安装前端依赖
pnpm install --frozen-lockfile

# 启动开发模式
pnpm tauri dev
```

完成开发环境准备和依赖安装后，也可双击 `start.bat` 启动开发模式。

### 构建发布版

```bash
pnpm tauri build
```

可执行文件位于 `src-tauri/target/release/vanish-trans.exe`，
NSIS 安装包位于 `src-tauri/target/release/bundle/nsis/`。

---

## 首次使用

1. 单击悬浮岛，打开完整工作区，再打开设置 → **翻译服务**。
2. 选择 **Google 免费翻译**（无需密钥，需能连接 Google），或选择 **自定义 API** 并填写 Base URL、API Key 和服务支持的模型名称。
3. 自定义 API 字段编辑后会在失焦时保存；检查保存反馈，点击 **测试连接** 验证服务配置。
4. 选中文本后按 `Alt+Q`，或在工作区输入文本后按 `Ctrl+Enter` 翻译。
5. 在悬浮岛查看、复制结果，或打开完整工作区继续编辑。全局快捷键可在设置中修改。

---

## 项目结构

```
VanishTrans/
├── src/                          # 前端 (React + TypeScript)
│   ├── App.tsx                   # 应用入口，窗口类型路由
│   ├── ScreenshotOverlay.tsx     # 截图 OCR 覆盖层
│   ├── types.ts                  # 共享类型定义
│   ├── features/
│   │   ├── TranslatePanel.tsx    # 翻译主面板（输入/输出/拖拽）
│   │   ├── SettingsPanel.tsx     # 设置面板（API/快捷键/术语/TM）
│   │   ├── HistoryPanel.tsx      # 翻译历史面板
│   │   ├── TmPanel.tsx           # 翻译记忆管理面板
│   │   ├── BallWindow.tsx        # 悬浮岛状态与工作区组合
│   │   ├── TranslationIslandView.tsx # 悬浮岛呈现
│   │   ├── IslandResultPanel.tsx # 已完成译文面板
│   │   └── QuickTranslateWindow.tsx # 快捷翻译窗口
│   ├── hooks/
│   │   ├── useTranslation.ts     # 翻译流程组合
│   │   ├── useTranslationSession.ts # 请求生命周期与翻译状态
│   │   ├── useConfig.ts          # 配置管理
│   │   ├── useMainLayout.ts      # 工作区导航、历史与窗口操作
│   │   ├── useTheme.ts           # 主题状态与窗口同步
│   │   └── useTauriEvents.ts     # Tauri 事件监听
│   ├── layouts/
│   │   └── MainLayout.tsx        # 主窗口布局
│   ├── components/               # 可复用 UI 组件
│   │   ├── HotkeyEditor.tsx      # 快捷键编辑器
│   │   ├── LanguageSwitcher.tsx  # 语言切换器
│   │   ├── OverlayDrawer.tsx     # 抽屉组件
│   │   ├── AnimatedList.tsx      # 动画列表
│   │   └── ...
│   └── lib/
│       └── fileParser.ts         # SRT/JSON/TXT 文件解析
├── src-tauri/                    # 后端 (Rust + Tauri 2)
│   └── src/
│       ├── lib.rs                # 应用入口，窗口/托盘/快捷键
│       ├── commands/             # Tauri 命令（IPC 接口）
│       ├── translate.rs          # 翻译提供商路由与取消
│       ├── translate/            # 请求构造、提供商、SSE 解析
│       ├── config/               # 配置、凭据、持久化与请求序号
│       ├── tm.rs                 # 翻译记忆 (SQLite)
│       ├── history.rs            # 翻译历史存储
│       ├── ocr.rs                # Windows OCR 截图识别
│       ├── keyboard.rs           # 键盘模拟（Ctrl+C/V）
│       ├── clipboard.rs          # 剪贴板守卫
│       ├── logging.rs            # 文件日志（轮转）
│       ├── cursor.rs             # 光标位置工具
│       ├── window_regions.rs     # 悬浮球位置计算
│       └── setup/                # 窗口/快捷键/剪贴板初始化
│           ├── shortcuts.rs      # 全局快捷键注册
│           ├── tray.rs           # 系统托盘
│           └── clipboard_watch.rs # 剪贴板监听
└── start.bat                     # 一键启动脚本
```

---

## 开发验证

```bash
pnpm check       # 架构、命令清单、TypeScript、前端测试与 ESLint
pnpm check:rust  # Rust 格式、Clippy 与测试
pnpm build       # 前端生产构建
```

当前模块职责和并发约定见[架构文档](docs/architecture/ARCHITECTURE.md)，其他资料见[文档索引](docs/README.md)。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/) |
| 前端 | React 18 + TypeScript + TailwindCSS |
| 后端 | Rust + reqwest + rusqlite |
| OCR | Windows.Media.Ocr (原生 API) |
| 存储 | SQLite (TM) + JSON (历史/配置) |

---

## 快捷键一览

| 快捷键 | 功能 |
|--------|------|
| `Alt+Q` | 划词翻译 |
| `Alt+R` | 原地替换翻译 |
| `Alt+W` | 截图 OCR 翻译 |
| `Ctrl+Enter` | 翻译输入框中的文本 |
| `Alt+Esc` | 关闭截图覆盖层 |

> 快捷键可在设置中自定义

---

## License

项目代码采用 [MIT](LICENSE) 许可。内置 Inter 和 Noto Sans SC 字体采用 SIL OFL 1.1，来源及许可证见[字体说明](public/fonts/FONT-SOURCES.md)。
