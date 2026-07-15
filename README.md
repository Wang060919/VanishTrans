<div align="center">

# VanishTrans

**轻量级 AI 驱动的 Windows 翻译工具**

基于 Tauri 2 + React 18 + TypeScript 构建，体积小、启动快、隐私安全。

</div>

---

## 功能特性

### 核心翻译

| 快捷键 | 功能 |
|--------|------|
| `Alt+Q` | **划词翻译** — 选中文本，弹窗显示翻译结果 |
| `Alt+R` | **原地替换** — 选中文本，直接替换为翻译结果 |
| `Alt+W` | **截图 OCR** — 截屏选取区域，识别文字并翻译 |
| `Enter` | 输入框中按 Enter 翻译 |
| 拖拽文件 | 拖入 `.txt` / `.srt` / `.json` 文件自动翻译 |

### 翻译引擎

- 兼容所有 **OpenAI API** 格式的服务（GPT、DeepSeek、Claude、Ollama 等）
- **流式输出** — 逐字显示翻译结果，感知速度更快
- **智能方向** — 自动检测中英文，自动选择翻译方向
- **术语表** — 自定义固定翻译规则（如 "AI" → "人工智能"）

### 翻译记忆 (TM)

- SQLite 本地存储，精确匹配命中时跳过 API 调用
- 自动记录每次翻译，支持搜索、删除、清空
- 导出/导入 CSV 格式

### 全局悬浮翻译球

- 桌面常驻 52×52 品牌 logo 圆球
- 点击切换主窗口，拖拽移动位置
- 位置自动保存，重启恢复

### 其他特性

- 🌙 **深色模式** — 跟随系统或手动切换
- 📋 **剪贴板监听** — 开启后自动翻译复制的文本
- 📜 **翻译历史** — 保存最近 200 条记录，支持搜索
- 📌 **窗口置顶** — 固定窗口在最上层
- ⌨️ **自定义快捷键** — 可修改全局快捷键组合
- 🔐 **API Key 安全** — 使用 Windows 凭据管理器存储

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri 2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/Wang060919/VanishTrans.git
cd VanishTrans

# 安装前端依赖
pnpm install

# 启动开发模式
pnpm tauri dev
```

或双击 `start.bat` 一键启动。

### 构建发布版

```bash
pnpm tauri build
```

输出位于 `src-tauri/target/release/bundle/`。

---

## 首次使用

1. 启动后点击 ⚙ 打开设置
2. 填入 **Base URL**（如 `https://api.openai.com` 或你的 API 代理地址）
3. 填入 **API Key**
4. 填入 **Model Name**（如 `gpt-4o-mini`、`deepseek-chat`）
5. 按 `Alt+Q` 选中文本测试翻译

---

## 项目结构

```
VanishTrans/
├── src/                          # 前端 (React + TypeScript)
│   ├── App.tsx                   # 应用入口，窗口类型路由
│   ├── features/
│   │   ├── TranslatePanel.tsx    # 翻译主面板（输入/输出/拖拽）
│   │   ├── SettingsPanel.tsx     # 设置面板（API/快捷键/术语/主题）
│   │   ├── HistoryPanel.tsx      # 翻译历史面板
│   │   ├── TmPanel.tsx           # 翻译记忆管理面板
│   │   └── BallWindow.tsx        # 悬浮翻译球窗口
│   ├── hooks/
│   │   ├── useTranslation.ts     # 翻译状态管理
│   │   ├── useConfig.ts          # 配置管理
│   │   └── useTauriEvents.ts     # Tauri 事件监听
│   ├── components/               # 可复用 UI 组件
│   └── lib/
│       └── fileParser.ts         # SRT/JSON 文件解析
├── src-tauri/                    # 后端 (Rust + Tauri 2)
│   └── src/
│       ├── lib.rs                # 应用入口，窗口/托盘/快捷键
│       ├── commands.rs           # Tauri 命令（IPC 接口）
│       ├── translate.rs          # API 翻译核心 + 配置管理
│       ├── tm.rs                 # 翻译记忆 (SQLite)
│       ├── history.rs            # 翻译历史存储
│       ├── ocr.rs                # Windows OCR 截图识别
│       ├── keyboard.rs           # 键盘模拟（Ctrl+C/V）
│       ├── clipboard.rs          # 剪贴板守卫
│       └── setup/                # 窗口/快捷键/剪贴板初始化
└── start.bat                     # 一键启动脚本
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | [Tauri 2](https://v2.tauri.app/) |
| 前端 | React 18 + TypeScript + TailwindCSS |
| 后端 | Rust + reqwest + rusqlite |
| OCR | Windows.Media.Ocr (原生 API) |
| 存储 | SQLite (翻译历史 + TM) + JSON (配置) |

---

## 快捷键一览

| 快捷键 | 功能 |
|--------|------|
| `Alt+Q` | 划词翻译 |
| `Alt+R` | 原地替换翻译 |
| `Alt+W` | 截图 OCR 翻译 |
| `Alt+Esc` | 关闭截图覆盖层 |

> 快捷键可在设置中自定义

---

## License

MIT
