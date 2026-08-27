# VanishTrans 功能实现计划
## 基于 Easydict 和 CleanShot X 的功能优化

**创建日期：** 2026-07-30  
**状态：** 待评审

---

## 📋 计划概述

本计划旨在为 VanishTrans 添加参考 Easydict 和 CleanShot X 的核心功能，提升产品竞争力和用户体验。

### 计划目标
1. 提供差异化的核心功能
2. 提升翻译质量和准确度
3. 改善用户交互体验
4. 增强产品竞争力

---

## 🎯 功能清单（按优先级）

### 第一阶段：快速见效（1-2 周）

#### 功能 1：完善快捷键系统 ⭐⭐⭐
**预计时间：** 1-2 天  
**难度：** 低  
**优先级：** 高

**当前状态：**
- 已有部分快捷键（截图、主窗口切换等）
- 快捷键硬编码，用户无法自定义
- 缺少部分常用功能的快捷键

**目标：**
- 添加完整的快捷键覆盖
- 用户可自定义所有快捷键
- 快捷键冲突检测和提示

**需要添加的快捷键：**
```
当前快捷键：
- Ctrl+Shift+A: 截图 OCR
- (其他待探索)

新增快捷键：
- 截图翻译: Ctrl+Shift+X (可自定义)
- 划词翻译: Ctrl+Shift+T (可自定义)
- 翻译历史: Ctrl+Shift+H (可自定义)
- 显示/隐藏主窗口: Ctrl+Shift+M (可自定义)
- 清空历史: Ctrl+Shift+C (可自定义)
```

**实施步骤：**
1. 探索现有快捷键实现（Tauri globalShortcut）
2. 创建快捷键配置管理模块
3. 在设置面板添加快捷键配置 UI
4. 实现快捷键冲突检测
5. 持久化保存到配置文件
6. 测试所有快捷键功能

**技术方案：**
```rust
// src-tauri/src/shortcuts.rs (新建)
pub struct ShortcutConfig {
    screenshot_ocr: String,  // "Ctrl+Shift+X"
    clipboard_translate: String,
    show_history: String,
    toggle_main: String,
}

impl ShortcutConfig {
    pub fn load() -> Result<Self, String>;
    pub fn save(&self) -> Result<(), String>;
    pub fn validate(&self) -> Result<(), String>;
}
```

**UI 设计：**
```
设置面板 > 快捷键
┌──────────────────────────────┐
│ 功能              快捷键     │
├──────────────────────────────┤
│ 截图翻译    [Ctrl+Shift+X] ✏️│
│ 划词翻译    [Ctrl+Shift+T] ✏️│
│ 翻译历史    [Ctrl+Shift+H] ✏️│
│ 显示主窗口  [Ctrl+Shift+M] ✏️│
│                              │
│        [恢复默认]  [保存]   │
└──────────────────────────────┘
```

**验收标准：**
- [ ] 所有功能都有快捷键
- [ ] 用户可以自定义每个快捷键
- [ ] 快捷键冲突有提示
- [ ] 配置持久化保存
- [ ] 快捷键在全局生效

---

#### 功能 2：多翻译引擎对比 ⭐⭐⭐
**预计时间：** 3-5 天  
**难度：** 中  
**优先级：** 高

**当前状态：**
- 只支持 OpenAI 兼容接口
- 只显示单一翻译结果
- 用户无法对比不同翻译

**目标：**
- 支持多个翻译引擎（OpenAI、DeepL、Google、Bing）
- 同时显示多个翻译结果
- 用户可选择/复制任一结果
- 可配置启用的引擎

**支持的翻译引擎：**
1. **OpenAI** (已有)
2. **DeepL API** (新增)
3. **Google Translate API** (新增)
4. **Bing Translator API** (新增)
5. **本地翻译模型** (可选，长期)

**实施步骤：**

**Phase 1: 抽象翻译引擎接口 (1 天)**
```rust
// src-tauri/src/translate/engine.rs (新建)
#[async_trait]
pub trait TranslationEngine {
    fn name(&self) -> &str;
    fn supports_language(&self, lang: &str) -> bool;
    
    async fn translate(
        &self,
        text: &str,
        source_lang: &str,
        target_lang: &str,
    ) -> Result<TranslationResult, String>;
    
    async fn translate_stream(
        &self,
        text: &str,
        source_lang: &str,
        target_lang: &str,
        on_chunk: impl Fn(String),
    ) -> Result<String, String>;
}

pub struct TranslationResult {
    pub text: String,
    pub engine: String,
    pub source_lang: String,
    pub target_lang: String,
    pub timestamp: u64,
}
```

**Phase 2: 实现各引擎适配器 (1-2 天)**
```rust
// OpenAI 引擎 (已有，重构)
pub struct OpenAIEngine {
    config: Arc<ApiConfig>,
}

// DeepL 引擎 (新增)
pub struct DeepLEngine {
    api_key: String,
    base_url: String,
}

// Google 引擎 (新增)
pub struct GoogleEngine {
    api_key: String,
}

// Bing 引擎 (新增)
pub struct BingEngine {
    api_key: String,
}
```

**Phase 3: 引擎管理器 (0.5 天)**
```rust
pub struct EngineManager {
    engines: Vec<Box<dyn TranslationEngine>>,
}

impl EngineManager {
    pub async fn translate_all(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Vec<TranslationResult> {
        // 并发请求所有启用的引擎
    }
}
```

**Phase 4: UI 改造 (1 天)**
```typescript
// src/components/MultiEngineResults.tsx (新建)
interface TranslationResult {
  engine: string;
  text: string;
  timestamp: number;
  error?: string;
}

<div className="translation-results">
  {results.map(result => (
    <div key={result.engine} className="engine-result">
      <div className="engine-name">{result.engine}</div>
      <div className="engine-text">{result.text}</div>
      <button onClick={() => copy(result.text)}>复制</button>
    </div>
  ))}
</div>
```

**UI 设计：**
```
灵动岛 - 展开模式
┌────────────────────────────┐
│ Hello World                │
├────────────────────────────┤
│ 🤖 OpenAI                  │
│ 你好世界                   │
│                      [复制] │
├────────────────────────────┤
│ 🔷 DeepL                   │
│ 你好，世界                 │
│                      [复制] │
├────────────────────────────┤
│ 🌐 Google                  │
│ 世界，你好                 │
│                      [复制] │
└────────────────────────────┘
```

**Phase 5: 配置和测试 (0.5 天)**
- 设置面板添加引擎配置
- 用户可启用/禁用引擎
- 配置 API Key

**验收标准：**
- [ ] 支持至少 3 个翻译引擎
- [ ] 同时显示多个结果
- [ ] 并发请求，不阻塞 UI
- [ ] 用户可配置启用的引擎
- [ ] 单个引擎失败不影响其他

---

#### 功能 3：滚动截图 + OCR 翻译 ⭐⭐⭐
**预计时间：** 7-10 天  
**难度：** 高  
**优先级：** 高（差异化）

**当前状态：**
- 只支持单屏截图
- 无法截取长页面/聊天记录
- 用户需要分多次截图

**目标：**
- 自动滚动捕获长页面
- 智能拼接成完整图片
- 整体 OCR 并翻译
- 适用于网页、聊天、文档

**应用场景：**
1. 翻译整篇长文章
2. 翻译完整聊天记录
3. 翻译长网页内容
4. 翻译 PDF 文档多页

**技术方案：**

**Phase 1: Windows 滚动截图研究 (1-2 天)**
- 研究 Windows UI Automation API
- 研究滚动检测和控制
- 研究图片拼接算法

**可能的实现方式：**
```
方案 A: UI Automation (推荐)
- 使用 Windows UI Automation
- 检测可滚动元素
- 自动滚动 + 截图
- 智能拼接

方案 B: 模拟滚轮
- 发送鼠标滚轮事件
- 固定间隔截图
- 简单拼接

方案 C: 浏览器插件
- 只支持浏览器
- 使用 Chrome DevTools Protocol
- 截取完整 DOM
```

**Phase 2: 滚动控制实现 (2-3 天)**
```rust
// src-tauri/src/screenshot/scrolling.rs (新建)
pub struct ScrollingCapture {
    target_window: HWND,
    scroll_step: i32,
    overlap_pixels: i32,
}

impl ScrollingCapture {
    pub async fn capture(&self) -> Result<Vec<Image>, String> {
        // 1. 获取窗口信息
        // 2. 计算滚动次数
        // 3. 循环：滚动 -> 截图 -> 保存
        // 4. 返回图片列表
    }
    
    fn scroll_window(&self, delta: i32) -> Result<(), String>;
    fn capture_current(&self) -> Result<Image, String>;
    fn detect_scroll_end(&self) -> bool;
}
```

**Phase 3: 图片拼接算法 (2-3 天)**
```rust
// src-tauri/src/screenshot/stitcher.rs (新建)
pub struct ImageStitcher {
    overlap: i32,
}

impl ImageStitcher {
    pub fn stitch(&self, images: Vec<Image>) -> Result<Image, String> {
        // 1. 检测图片间的重叠区域
        // 2. 对齐和裁剪
        // 3. 拼接成完整图片
        // 4. 返回最终图片
    }
    
    fn find_overlap(&self, img1: &Image, img2: &Image) -> i32;
    fn align_images(&self, img1: &Image, img2: &Image) -> (i32, i32);
}
```

**Phase 4: UI 交互设计 (1 天)**
```
用户操作流程：
1. 按下"滚动截图"快捷键
2. 选择要截图的窗口
3. 显示进度条（正在滚动 X/Y）
4. 拼接完成后显示预览
5. 确认后 OCR + 翻译
```

**UI 设计：**
```
滚动截图进度
┌────────────────────────┐
│  正在捕获长页面...     │
│  ████████░░  80%       │
│  已截取 8/10 屏        │
│                        │
│        [取消]          │
└────────────────────────┘

预览窗口
┌────────────────────────┐
│  [预览图片]            │
│  ┌──────────────────┐  │
│  │                  │  │
│  │   [长图预览]     │  │
│  │                  │  │
│  └──────────────────┘  │
│                        │
│  [重新截取] [OCR翻译]  │
└────────────────────────┘
```

**Phase 5: 集成和优化 (1 天)**
- 集成现有 OCR 功能
- 性能优化（大图处理）
- 错误处理（滚动失败、拼接失败）

**技术挑战：**
1. **滚动检测：** 如何知道页面已滚动到底？
   - 方案：比对连续两次截图，相同则到底
   
2. **窗口失焦：** 滚动过程中窗口可能失去焦点
   - 方案：截图前自动激活目标窗口
   
3. **拼接精度：** 图片对齐和重叠检测
   - 方案：使用图像相似度算法（SSIM）

4. **大图处理：** 长页面图片可能很大
   - 方案：流式处理，分块 OCR

**验收标准：**
- [ ] 能自动滚动并截图
- [ ] 图片拼接准确无缝
- [ ] 进度提示清晰
- [ ] 支持取消操作
- [ ] 整体 OCR 准确率高

---

### 第二阶段：体验提升（2-3 周）

#### 功能 4：截图预览和标注
**预计时间：** 5-7 天  
**难度：** 高  
**优先级：** 中

**当前状态：**
- 截图后直接 OCR
- 无法预览和确认
- 无法选择翻译区域

**目标：**
- 截图后显示预览
- 支持框选翻译区域
- 添加简单标注（箭头、高亮）
- 确认后再 OCR

**实施步骤：**

**Phase 1: 截图预览 UI (2 天)**
```typescript
// src/components/ScreenshotPreview.tsx (新建)
interface ScreenshotPreviewProps {
  image: string; // base64
  onConfirm: (regions: Region[]) => void;
  onCancel: () => void;
}

const ScreenshotPreview = ({ image, onConfirm, onCancel }) => {
  const [selectedRegions, setSelectedRegions] = useState<Region[]>([]);
  
  return (
    <div className="screenshot-preview">
      <canvas ref={canvasRef} />
      <Toolbar>
        <Button icon="select">框选区域</Button>
        <Button icon="arrow">箭头</Button>
        <Button icon="highlight">高亮</Button>
        <Button icon="text">文字</Button>
      </Toolbar>
      <Actions>
        <Button onClick={onCancel}>取消</Button>
        <Button onClick={() => onConfirm(selectedRegions)}>翻译</Button>
      </Actions>
    </div>
  );
};
```

**Phase 2: Canvas 绘图功能 (2-3 天)**
- 框选工具：矩形选择翻译区域
- 箭头工具：添加指向性标注
- 高亮工具：高亮重要文字
- 文字工具：添加文字说明

**Phase 3: 区域 OCR (1 天)**
```rust
// 只 OCR 用户选择的区域
pub async fn ocr_regions(
    image: &Image,
    regions: Vec<Rectangle>,
) -> Result<Vec<OcrResult>, String> {
    let mut results = Vec::new();
    for region in regions {
        let cropped = image.crop(region);
        let text = ocr_image(&cropped).await?;
        results.push(OcrResult { region, text });
    }
    Ok(results)
}
```

**Phase 4: 集成和优化 (1 天)**

**验收标准：**
- [ ] 截图后显示预览
- [ ] 可以框选多个区域
- [ ] 支持基础标注工具
- [ ] 只翻译选中区域
- [ ] 可以保存标注后的图片

---

#### 功能 5：划词悬浮图标
**预计时间：** 2-3 天  
**难度：** 中  
**优先级：** 中

**当前状态：**
- 划词后直接显示灵动岛
- 容易误触发
- 无法取消

**目标：**
- 划词后显示小浮标
- 鼠标悬浮/点击才翻译
- 减少误触发
- 更优雅的交互

**UI 设计：**
```
划词后：
 Hello World [🌐] ← 小浮标
 
悬浮后：
 Hello World [🌐 翻译]
             ↓
        显示灵动岛
```

**实施步骤：**
1. 创建悬浮图标组件
2. 划词后显示图标（延迟 300ms）
3. 鼠标悬浮/点击触发翻译
4. 鼠标移开自动隐藏

**验收标准：**
- [ ] 划词后显示小图标
- [ ] 图标位置跟随选中文本
- [ ] 悬浮延迟合理（~300ms）
- [ ] 点击后正常翻译

---

#### 功能 6：离线 OCR
**预计时间：** 5-7 天  
**难度：** 高  
**优先级：** 中

**当前状态：**
- 可能依赖在线 OCR API
- 需要网络连接
- 响应速度受网络影响

**目标：**
- 集成 Windows OCR API（离线）
- 或 Tesseract OCR（开源）
- 离线/在线模式切换
- 提升识别速度

**技术方案：**

**方案 A: Windows OCR API (推荐)**
```rust
// 使用 Windows.Media.Ocr
use windows::Media::Ocr::{OcrEngine, OcrResult};

pub async fn ocr_offline_windows(
    image: &Image,
    language: &str,
) -> Result<String, String> {
    let engine = OcrEngine::TryCreateFromLanguage(language)?;
    let bitmap = image_to_softwarebitmap(image)?;
    let result = engine.RecognizeAsync(bitmap)?.await?;
    Ok(result.Text()?.to_string())
}
```

**方案 B: Tesseract OCR**
```rust
// 使用 tesseract-rs
use tesseract::Tesseract;

pub fn ocr_offline_tesseract(
    image: &Image,
    language: &str,
) -> Result<String, String> {
    let tess = Tesseract::new(None, Some(language))?;
    tess.set_image_from_mem(image.data())?;
    Ok(tess.get_text()?)
}
```

**验收标准：**
- [ ] 离线 OCR 正常工作
- [ ] 识别准确率 > 90%
- [ ] 响应速度 < 2s
- [ ] 用户可切换离线/在线

---

### 第三阶段：生态完善（长期）

#### 功能 7：词典集成
**预计时间：** 3-5 天  
**难度：** 中  
**优先级：** 低

**目标：**
- 显示单词详细释义
- 提供例句
- 音标、词性、同义词

#### 功能 8：云端同步和分享
**预计时间：** 5-7 天  
**难度：** 中  
**优先级：** 低

**目标：**
- 翻译历史云同步
- 生成分享链接
- 导出 PDF/Markdown

---

## 🗂️ 项目结构调整

### 新增文件结构
```
src-tauri/src/
├── shortcuts.rs          # 快捷键管理 (新增)
├── translate/
│   ├── mod.rs
│   ├── engine.rs         # 引擎接口 (新增)
│   ├── openai.rs         # OpenAI 引擎 (重构)
│   ├── deepl.rs          # DeepL 引擎 (新增)
│   ├── google.rs         # Google 引擎 (新增)
│   ├── bing.rs           # Bing 引擎 (新增)
│   └── manager.rs        # 引擎管理器 (新增)
├── screenshot/
│   ├── scrolling.rs      # 滚动截图 (新增)
│   ├── stitcher.rs       # 图片拼接 (新增)
│   └── preview.rs        # 截图预览 (新增)
└── ocr/
    ├── mod.rs
    ├── online.rs         # 在线 OCR
    └── offline.rs        # 离线 OCR (新增)

src/
├── components/
│   ├── MultiEngineResults.tsx    # 多引擎结果 (新增)
│   ├── ScreenshotPreview.tsx     # 截图预览 (新增)
│   ├── ScrollingProgress.tsx     # 滚动进度 (新增)
│   └── FloatingIcon.tsx          # 悬浮图标 (新增)
└── features/
    └── ShortcutSettings.tsx      # 快捷键设置 (新增)
```

---

## 📊 实施优先级建议

### 推荐实施顺序

**Week 1-2: 快速见效**
1. ✅ 完善快捷键系统 (1-2 天)
2. ✅ 多翻译引擎对比 (3-5 天)

**Week 3-4: 差异化功能**
3. ✅ 滚动截图 + OCR (7-10 天)

**Week 5-6: 体验提升**
4. 截图预览和标注 (5-7 天)
5. 划词悬浮图标 (2-3 天)
6. 离线 OCR (5-7 天)

**Long-term: 生态完善**
7. 词典集成
8. 云端同步

---

## 🎯 关键指标

### 成功标准

**功能完整度：**
- [ ] 快捷键覆盖所有核心功能
- [ ] 至少支持 3 个翻译引擎
- [ ] 滚动截图成功率 > 90%
- [ ] 截图拼接准确率 > 95%

**性能指标：**
- [ ] 多引擎翻译响应 < 3s
- [ ] 滚动截图速度 < 1s/屏
- [ ] 离线 OCR 响应 < 2s

**用户体验：**
- [ ] 快捷键冲突检测
- [ ] 操作可取消/撤销
- [ ] 错误提示清晰
- [ ] 界面流畅不卡顿

---

## ⚠️ 风险和缓解

### 技术风险

**1. 滚动截图兼容性**
- **风险：** 不同应用的滚动机制不同
- **缓解：** 提供多种滚动方案，用户可选择

**2. 图片拼接准确性**
- **风险：** 复杂页面拼接可能错位
- **缓解：** 提供手动调整功能，显示拼接预览

**3. 多引擎 API 成本**
- **风险：** 多个引擎同时调用增加成本
- **缓解：** 用户可选择启用的引擎，默认只启用 1-2 个

**4. 离线 OCR 准确率**
- **风险：** 离线识别准确率可能低于在线
- **缓解：** 提供离线/在线切换，默认在线

### 时间风险

**1. 滚动截图复杂度高**
- **风险：** 可能超出预计时间
- **缓解：** 先实现基础版本，后续迭代优化

**2. 多引擎适配工作量大**
- **风险：** 每个引擎 API 不同
- **缓解：** 使用统一接口抽象，逐个实现

---

## 📝 后续行动

### 下一步

1. **评审计划** - 确认功能优先级和实施顺序
2. **技术调研** - 深入研究滚动截图和图片拼接
3. **开始实施** - 从快捷键系统开始
4. **持续迭代** - 每完成一个功能立即测试和优化

---

## 📚 参考资源

### Easydict
- GitHub: https://github.com/tisfeng/Easydict
- 学习重点：多引擎对比、语言识别、划词交互

### CleanShot X
- 官网: https://cleanshot.com/
- 学习重点：滚动截图、截图标注、快捷键设计

### 技术文档
- Windows UI Automation: https://docs.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32
- Windows OCR API: https://docs.microsoft.com/en-us/uwp/api/windows.media.ocr
- Image Stitching: https://opencv.org/

---

**计划状态：** 待评审  
**预计总时长：** 4-6 周（根据实施优先级）  
**建议开始：** 快捷键系统（快速见效）
