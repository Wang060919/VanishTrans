# VanishTrans 灵动岛重构任务文档

## 📋 任务概述

重构 VanishTrans 的灵动岛动画系统，解决两个核心问题：
1. **动画抖动**：展开/收起时文字和内容抖动
2. **布局优化**：将竖长窗口改为横向扁宽布局，更像 Mac 灵动岛

## 🎯 目标

- ✅ 完全消除展开/收起动画的抖动和闪烁
- ✅ 改为 720x380 横向布局，提升用户体验
- ✅ 保持所有现有功能正常工作
- ✅ 通过所有测试用例

---

## 📚 背景知识

### 当前架构

**技术栈：**
- Tauri v2 (Rust 后端)
- React + TypeScript (前端)
- Framer Motion (动画库)

**窗口模式：**
| 模式 | 当前尺寸 | 说明 |
|------|---------|------|
| idle | 116x42 | 待机胶囊 |
| peek | 116x42 | 预览（内容动画） |
| actions | 296x60 | 快速操作 |
| status | 264x52 | 翻译状态 |
| full | 420x520 | 完整翻译窗口 |

**核心文件：**
```
src/features/
├── BallWindow.tsx              # 窗口管理、模式切换
├── TranslationIslandView.tsx   # 灵动岛 UI 组件
└── MainWindowApp.tsx           # Full 模式的内容

src-tauri/src/
└── commands.rs                 # 后端窗口控制

src/index.css                   # 样式定义
```

### 问题根源

**问题 1：动画抖动**

当前实现：
```typescript
// 窗口带 400ms spring 动画
await setBallWindowBounds({...}, 400);

// CSS 也带 400ms spring 动画
transition: spring(stiffness: 300, damping: 30)
```

**原因：** 窗口动画和 CSS 动画使用不同缓动函数，不同步导致内容错位抖动。

**问题 2：布局不像 Mac**

当前 full 模式是 420x520 竖长窗口，Mac 的灵动岛展开是横向扁平。

---

## 🎯 解决方案

### 方案来源

参考开源项目 [RustyIsland](https://github.com/hasnain7abbas/RustyIsland)（同样是 Tauri + React 的灵动岛）

**核心策略：窗口瞬间调整 + CSS 慢动画**

```typescript
// ✅ 正确：窗口瞬间调整（0ms）
await setBallWindowBounds({x, y, width, height});  // 不传 durationMs

// ✅ CSS 自由动画（400ms）
// Framer Motion 处理内容动画
```

---

## 🔧 实施步骤

### Phase 1: 移除后端窗口动画（30分钟）

#### 1.1 删除 Spring 缓动函数

**文件：** `src-tauri/src/commands.rs`

**删除这个函数：**
```rust
#[cfg(target_os = "windows")]
fn island_morph_ease(progress: f64) -> f64 {
    // ... 整个函数删除
}
```

**修改 `set_ball_window_bounds` 命令：**

找到这段代码（约 180-210 行）：
```rust
if let Some(duration) = animation_duration {
    // 整个动画循环删除
    // 从 let started_at = Instant::now(); 
    // 到 break;
}
```

**改为：**
```rust
// 移除动画循环，直接设置最终位置
unsafe {
    SetWindowPos(
        hwnd,
        HWND::default(),
        x,
        y,
        outer_width,
        outer_height,
        SWP_NOACTIVATE | SWP_NOCOPYBITS | SWP_NOOWNERZORDER | SWP_NOZORDER,
    )
    .ok()?;
}
```

**简化函数签名：**
```rust
#[tauri::command]
pub async fn set_ball_window_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    // 删除 animation_duration 参数
) -> Result<(), String> {
    // ...
}
```

**期望结果：** 窗口调整变为瞬间完成，无动画。

---

### Phase 2: 调整前端窗口调整时序（40分钟）

#### 2.1 修改展开逻辑

**文件：** `src/features/BallWindow.tsx`

**找到 `transitionMode` 函数中的展开逻辑：**

当前可能是：
```typescript
// 展开到 actions/status/full
await setBallWindowBounds({...}, MORPH_SETTLE_MS);
```

**改为：**
```typescript
// 1. 立即调整窗口（瞬间）
await setBallWindowBounds({
  x: newX,
  y: newY,
  width: targetWidthPixels,
  height: targetHeightPixels,
});

// 2. 启动 CSS 动画
modeRef.current = target;
flushSync(() => setMode(target));
```

#### 2.2 修改收起逻辑

**找到收起到 idle 的代码段（约 205-240 行）：**

当前实现：
```typescript
if (target === "idle") {
  // ... 复杂的居中对齐逻辑
  await wait(MORPH_SETTLE_MS);
  await setBallWindowBounds({...});
}
```

**改为更简单的逻辑：**
```typescript
if (target === "idle") {
  const currentPos = await win.outerPosition();
  const currentSize = await win.outerSize();

  // 1. 启动 CSS 收起动画
  modeRef.current = "idle";
  noticeRef.current = "";
  setNotice("");
  flushSync(() => setMode("idle"));

  // 2. 等待 CSS 动画完成
  await wait(shouldReduceMotion ? 0 : MORPH_SETTLE_MS);

  // 3. 计算最终位置（根据 dockSide）
  const side = dockSideRef.current;
  let idleX = currentPos.x;
  
  if (side === "center") {
    idleX = currentPos.x + Math.round((currentSize.width - idleWidthPixels) / 2);
  } else if (side === "left") {
    idleX = currentPos.x + currentSize.width - idleWidthPixels;
  }
  // right: idleX = currentPos.x (不变)

  // 4. 瞬间调整窗口
  await setBallWindowBounds({
    x: idleX,
    y: currentPos.y,
    width: idleWidthPixels,
    height: idleHeightPixels,
  });

  idleOuterSizeRef.current = await win.outerSize();
  anchorPositionRef.current = await saveBallPosition({ x: idleX, y: currentPos.y }, false);
  return;
}
```

#### 2.3 移除临时修复

**文件：** `src/features/TranslationIslandView.tsx`

**删除 `shrinkingFromFull` 状态和相关逻辑：**
```typescript
// 删除这些
const [shrinkingFromFull, setShrinkingFromFull] = useState(false);
// 删除相关 useEffect
// 删除 className 中的 shrinkingFromFull 判断
```

**文件：** `src/index.css`

**删除临时的居中对齐 CSS：**
```css
/* 删除这个规则 */
.translation-island--shrinking {
  justify-content: center !important;
}
```

---

### Phase 3: 横向布局改造（1小时）

#### 3.1 更新尺寸常量

**文件：** `src/features/BallWindow.tsx`

```typescript
// 修改这两行
const FULL_WIDTH = 720;   // 从 420 改为 720
const FULL_HEIGHT = 380;  // 从 520 改为 380
```

**文件：** `src/features/TranslationIslandView.tsx`

```typescript
const ISLAND_GEOMETRY: Record<IslandMode, { width: number; height: number; borderRadius: number }> = {
  idle: { width: 116, height: 42, borderRadius: 21 },
  peek: { width: 116, height: 42, borderRadius: 21 },
  actions: { width: 296, height: 60, borderRadius: 30 },
  status: { width: 264, height: 52, borderRadius: 26 },
  full: { width: 720, height: 380, borderRadius: 28 },  // 修改这行
};
```

#### 3.2 重构 Full 模式布局

**文件：** `src/features/MainWindowApp.tsx`

**当前结构（竖向）：**
```tsx
<div className="translation-workspace">
  <header>顶部栏</header>
  <div className="editor-frame">原文区域</div>
  <div className="result-frame">译文区域</div>
  <footer>底部操作</footer>
</div>
```

**改为（横向）：**
```tsx
<div className="translation-workspace">
  <header className="workspace-header">
    <div className="brand">
      <VanishMark size={20} />
      <span>VanishTrans</span>
    </div>
    <div className="header-actions">
      <button onClick={onOpenHistory}>
        <Clock size={16} /> 历史
      </button>
      <button onClick={onOpenSettings}>
        <Settings size={16} /> 设置
      </button>
      <button onClick={onToggleFullscreen}>
        <Maximize2 size={16} />
      </button>
      <button onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  </header>

  <main className="workspace-content">
    <section className="source-panel">
      <header className="panel-header">
        <select value={sourceLanguage} onChange={onSourceLangChange}>
          {/* 语言选项 */}
        </select>
        <button onClick={onPasteSource}>
          <Clipboard size={14} /> 粘贴
        </button>
      </header>
      
      <textarea
        className="source-input"
        value={sourceText}
        onChange={onSourceChange}
        placeholder="输入、粘贴或截图翻译"
      />
      
      <footer className="panel-footer">
        <span>{sourceText.length} / 10,000</span>
      </footer>
    </section>

    <div className="content-divider" />

    <section className="target-panel">
      <header className="panel-header">
        <select value={targetLanguage} onChange={onTargetLangChange}>
          {/* 语言选项 */}
        </select>
        <button onClick={onSwapLanguages}>
          <ArrowLeftRight size={14} /> 交换
        </button>
      </header>
      
      <div className="target-result">
        {translationResult}
      </div>
    </section>
  </main>

  <footer className="workspace-footer">
    <button onClick={() => onRunAction("copy-source")}>
      <Clipboard size={16} /> 复制原文
    </button>
    <button onClick={() => onRunAction("copy-result")}>
      <Check size={16} /> 复制译文
    </button>
    <button onClick={() => onRunAction("screenshot-ocr")}>
      <ScanLine size={16} /> 智能选读
    </button>
    <button onClick={() => onRunAction("open-tm")}>
      <PanelTopOpen size={16} /> TM面板
    </button>
  </footer>
</div>
```

#### 3.3 更新 CSS 样式

**文件：** `src/index.css`

**找到 `.translation-workspace` 并修改：**

```css
.translation-workspace {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: 50px 1fr 50px;  /* 头部 内容 底部 */
  grid-template-columns: 1fr;
  background: var(--color-canvas);
  overflow: hidden;
}

/* 顶部标题栏 */
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
}

.workspace-header .brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.workspace-header .header-actions {
  display: flex;
  gap: 4px;
}

.workspace-header button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.58);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.workspace-header button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
}

/* 主内容区：左右分栏 */
.workspace-content {
  display: grid;
  grid-template-columns: 1fr auto 1fr;  /* 原文 | 分割线 | 译文 */
  gap: 0;
  overflow: hidden;
}

.source-panel,
.target-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-header select {
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
}

.panel-header button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.58);
  font-size: 11px;
  cursor: pointer;
}

.source-input {
  flex: 1;
  padding: 16px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  overflow-y: auto;
}

.source-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.target-result {
  flex: 1;
  padding: 16px;
  color: rgba(255, 255, 255, 0.88);
  font-size: 14px;
  line-height: 1.6;
  overflow-y: auto;
}

.panel-footer {
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-align: right;
}

.content-divider {
  width: 1px;
  background: rgba(255, 255, 255, 0.06);
}

/* 底部操作栏 */
.workspace-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
}

.workspace-footer button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.68);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.workspace-footer button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.88);
}
```

---

### Phase 4: 测试修复（30分钟）

#### 4.1 更新测试用例

**文件：** `src/features/BallWindow.test.tsx`

**找到所有涉及窗口动画的测试断言，移除 `durationMs` 检查：**

```typescript
// 原来的测试
expect(idleBoundsCall?.[1]).toHaveProperty("durationMs");
expect(idleBoundsCall?.[1]?.durationMs).toBeGreaterThan(0);

// 改为
expect(idleBoundsCall?.[1]).not.toHaveProperty("durationMs");
```

**更新 full 模式尺寸断言：**

```typescript
// 找到所有 420/520 的断言，改为 720/380
expect(setBallWindowBounds).toHaveBeenCalledWith({
  x: expect.any(Number),
  y: expect.any(Number),
  width: 720,   // 从 420 改为 720
  height: 380,  // 从 520 改为 380
});
```

**处理 Spring 动画的浮点数精度问题：**

```typescript
// 如果有这样的测试
expect(element).toHaveStyle({ width: "238px" });

// 改为容错的版本
const width = parseFloat(getComputedStyle(element).width);
expect(width).toBeCloseTo(238, 0);
```

#### 4.2 运行测试

```bash
npm test
```

**预期结果：** 所有测试通过

---

## ✅ 验证清单

完成后，手动测试以下场景：

### 动画测试
- [ ] Idle → Actions：无抖动，流畅展开
- [ ] Idle → Full：无抖动，流畅展开
- [ ] Full → Idle（点击收起）：无抖动，流畅收起
- [ ] Full → Idle（失去焦点）：无抖动，流畅收起
- [ ] Actions → Full：无抖动，递进展开
- [ ] 拖动窗口：位置计算正确

### 布局测试
- [ ] Full 模式是 720x380 横向布局
- [ ] 原文和译文左右对照显示
- [ ] 顶部和底部操作栏显示正常
- [ ] 文字滚动正常，不溢出
- [ ] 所有按钮可点击

### 功能测试
- [ ] 翻译功能正常
- [ ] 复制功能正常
- [ ] 语言切换正常
- [ ] 历史记录可打开
- [ ] 设置面板可打开

---

## 📁 相关文档

项目中已创建的参考文档：

1. **RUSTYISLAND_ANALYSIS.md** - RustyIsland 项目分析
2. **HORIZONTAL_LAYOUT_DESIGN.md** - 横向布局设计方案
3. **DYNAMIC_ISLAND_REFACTOR_PLAN.md** - 原始重构计划（方案C）
4. **OVERFLOW_TEST_INSTRUCTIONS.md** - Overflow 测试说明

---

## 🐛 可能遇到的问题

### 问题 1：窗口位置计算错误

**症状：** 收起时窗口跳到错误位置

**解决：** 检查 `dockSide` 的位置计算逻辑：
- `center`: `x + (oldWidth - newWidth) / 2`
- `left`: `x + oldWidth - newWidth`
- `right`: `x` 不变

### 问题 2：CSS 动画不流畅

**症状：** 内容展开/收起卡顿

**解决：** 确认 Framer Motion 配置：
```typescript
const ISLAND_MORPH = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};
```

### 问题 3：横向布局溢出

**症状：** 文字超出面板边界

**解决：** 添加滚动和换行：
```css
.source-input,
.target-result {
  overflow-y: auto;
  word-wrap: break-word;
  word-break: break-word;
}
```

### 问题 4：测试失败

**症状：** 某些测试用例失败

**解决：**
1. 检查是否移除了所有 `durationMs` 断言
2. 更新所有尺寸断言（420→720, 520→380）
3. 使用 `toBeCloseTo` 处理浮点数

---

## 📞 联系信息

如遇到问题，可以：
1. 查看 `src/features/BallWindow.tsx` 的注释
2. 运行 `npm test -- --watch` 实时查看测试结果
3. 查看浏览器控制台的错误信息（F12）

---

## 🎯 成功标准

重构完成后应达到：
- ✅ 所有单元测试通过（85/85）
- ✅ 动画完全流畅，无抖动无闪烁
- ✅ 横向布局美观实用
- ✅ 所有现有功能正常工作
- ✅ 代码更简洁（移除了复杂的同步逻辑）

预计总耗时：**2-2.5 小时**

Good luck! 🚀
