# 灵动岛架构重构计划

## 目标
实现完全丝滑的动画，无闪烁、无抖动、无bug

## 方案C：固定小窗口 + 内容溢出

### 核心理念
- 窗口始终保持 **idle 大小（116x42）**
- 内容通过 **overflow: visible** 溢出显示
- **纯 CSS 动画**，无需调整原生窗口尺寸
- 参考 iOS 灵动岛的实际行为

---

## 技术可行性验证

### 1. Tauri 窗口溢出渲染 ✅/❌
**问题：** Tauri 窗口是否支持内容溢出显示？

**验证方法：**
```rust
// 窗口配置
decorations: false
transparent: true
always_on_top: true
```

**测试：**
- [ ] 创建 116x42 窗口
- [ ] 内容设置 420x520 并使用 `overflow: visible`
- [ ] 确认内容是否完整显示在窗口边界外

**预期结果：** 
- ✅ 内容完整显示
- ❌ 内容被窗口裁剪（方案不可行）

---

### 2. 点击穿透与交互区域 ✅/❌
**问题：** 溢出内容是否可以响应鼠标事件？

**场景：**
```
窗口 116px 宽
内容 420px 宽（溢出 304px）
```

**需要验证：**
- [ ] 溢出部分是否可点击？
- [ ] 透明区域是否会拦截点击？
- [ ] `pointer-events: none` 是否能穿透？

**Tauri 配置：**
```rust
#[cfg(target_os = "windows")]
set_transparent_click_through(window, true)?;
```

---

### 3. 窗口背景透明度 ✅/❌
**问题：** 窗口外透明区域是否完全不可见？

**测试：**
- [ ] 设置 `background: transparent`
- [ ] 检查是否有阴影/边框/轮廓
- [ ] 验证 WebView2 是否完全透明

---

### 4. 拖拽区域定义 ✅/❌
**问题：** 如何在固定小窗口中定义可拖拽区域？

**当前实现：**
```typescript
data-tauri-drag-region
```

**需要验证：**
- [ ] idle 模式：整个 116x42 可拖拽
- [ ] full 模式：顶部区域可拖拽，内容区域不可拖拽
- [ ] 溢出内容的拖拽是否正确

---

### 5. 窗口定位与锚点 ✅/❌
**问题：** 固定小窗口如何正确定位？

**场景：**
```
Idle: 窗口左上角 = 锚点
Full: 窗口左上角 = 锚点 - (420-116)/2  // 居中展开
```

**计算逻辑：**
- [ ] Idle → Full：窗口位置**不变**，内容向外扩展
- [ ] Full → Idle：窗口位置**不变**，内容收缩
- [ ] 拖动 idle：锚点 = 窗口左上角
- [ ] 拖动 full：锚点 = 窗口中心？还是内容中心？

---

## 架构设计

### 当前架构（有问题）
```
BallWindow.tsx
  ├─ 管理窗口尺寸（116/296/420）
  ├─ 管理窗口位置
  └─ 触发 CSS 动画

TranslationIslandView.tsx
  ├─ CSS 内容尺寸变化
  └─ Framer Motion 动画
```

**问题：** 窗口尺寸和内容尺寸必须同步，容易错位

---

### 新架构（方案C）
```
BallWindow.tsx
  ├─ 窗口始终 116x42（idle 大小）
  ├─ 只管理位置，不管理尺寸
  └─ 触发 CSS 动画

TranslationIslandView.tsx
  ├─ 内容自由缩放（116 ↔ 420）
  ├─ overflow: visible 允许溢出
  └─ Framer Motion Spring 动画
```

**优点：**
- ✅ 窗口不变，内容自由动画
- ✅ 无需同步窗口和内容
- ✅ 文字位置相对窗口稳定
- ✅ 完全参考 iOS 灵动岛

---

## CSS 架构调整

### 当前 CSS
```css
.translation-island__surface {
  width: 116px;  /* 跟随模式变化 */
  height: 42px;
  overflow: hidden;  /* 裁剪内容 */
}
```

### 新 CSS
```css
.ball-window {
  width: 116px;      /* 固定不变 */
  height: 42px;
  overflow: visible; /* 允许溢出 ✅ */
  pointer-events: none; /* 透明区域穿透 */
}

.translation-island__surface {
  width: 116px;      /* 动画改变 */
  height: 42px;
  pointer-events: auto; /* 内容可交互 */
  transform-origin: center top; /* 居中展开 */
}

/* Idle */
.translation-island__surface[data-mode="idle"] {
  width: 116px;
  height: 42px;
}

/* Full */
.translation-island__surface[data-mode="full"] {
  width: 420px;
  height: 520px;
  /* 相对父容器居中 */
  margin-left: -152px; /* -(420-116)/2 */
}
```

---

## 窗口定位逻辑

### 当前逻辑（每次调整窗口）
```typescript
// Idle → Full
setBallWindowBounds({ x, y, width: 420, height: 520 });

// Full → Idle
setBallWindowBounds({ x, y, width: 116, height: 42 });
```

### 新逻辑（固定窗口）
```typescript
// 初始化：设置固定窗口
await win.setSize({ width: 116, height: 42 });

// Idle → Full：只改变 CSS，窗口不动
setMode("full");  // CSS 动画处理

// Full → Idle：只改变 CSS，窗口不动
setMode("idle");  // CSS 动画处理

// 拖动：只移动位置，不改尺寸
await win.setPosition({ x, y });
```

---

## 风险评估

### 高风险 🔴
1. **Tauri 是否支持内容溢出？**
   - 如果不支持，方案完全不可行
   - 需要先验证

2. **溢出内容的点击事件？**
   - 如果溢出部分不可点击，full 模式无法使用
   - 可能需要调整窗口到实际内容大小

### 中风险 🟡
3. **透明区域的穿透？**
   - 可能需要复杂的 `pointer-events` 配置
   - Windows DWM 可能有限制

4. **拖拽区域定义？**
   - 需要精确控制哪些区域可拖拽
   - 可能需要 JS 实现自定义拖拽

### 低风险 🟢
5. **CSS 动画性能？**
   - 已经用 Spring + GPU 加速
   - 应该没问题

---

## 实施计划

### Phase 1: 技术验证（1-2小时）
- [ ] 创建简单的测试窗口
- [ ] 验证内容是否可以溢出显示
- [ ] 验证溢出内容是否可点击
- [ ] 验证透明穿透
- [ ] **决定是否继续**

### Phase 2: 架构设计（30分钟）
- [ ] 设计新的窗口管理逻辑
- [ ] 设计新的 CSS 结构
- [ ] 设计事件处理流程

### Phase 3: 实现（2-3小时）
- [ ] 重构 BallWindow.tsx
- [ ] 重构 CSS
- [ ] 调整拖拽逻辑
- [ ] 调整点击穿透

### Phase 4: 测试（1小时）
- [ ] 测试所有模式切换
- [ ] 测试拖动
- [ ] 测试点击事件
- [ ] 修复所有测试用例

---

## 回退方案

如果方案C验证失败，回到**优化版方案B**：
- 使用当前的居中对齐方案
- 微调动画时长
- 优化窗口调整时机
- 接受 400ms 的窗口尺寸不匹配

---

## 下一步

**立即行动：Phase 1 技术验证**

创建一个最小测试案例验证 Tauri 窗口溢出。

是否开始验证？
