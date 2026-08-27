# 灵动岛失焦收回动画优化方案

## 当前问题分析

### 问题 1：actions 模式失焦使用 instant（无动画）
```typescript
// 当前代码：src/features/BallWindow.tsx:798
if (!focused && shouldCollapseActions) {
  void transitionMode("idle", { motion: "instant", reason: "focus-loss" });
}
```

**问题：**
- `motion: "instant"` 直接跳过动画
- 用户体验不够平滑，有"闪回"的感觉
- 与 macOS Dynamic Island 的体验不一致

### 问题 2：CSS transition 可以更优化
```css
/* 当前：280ms 标准缓动 */
.translation-island__surface {
  transition:
    width 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
    height 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-radius 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

**问题：**
- 失焦收回应该比展开更快（更响应）
- 缓动曲线可以针对收回场景优化
- 目前展开和收回使用相同的时长和曲线

---

## 优化方案

### 方案 A：移除 instant motion，统一使用动画

#### 1. 修改 BallWindow.tsx
```typescript
// 修改前
if (!focused && shouldCollapseActions) {
  void transitionMode("idle", { motion: "instant", reason: "focus-loss" });
}

// 修改后
if (!focused && shouldCollapseActions) {
  void transitionMode("idle", { reason: "focus-loss" }); // 使用默认动画
}
```

**收益：**
- ✅ 失焦收回有流畅动画
- ✅ 用户体验更好
- ✅ 与 macOS Dynamic Island 一致

**风险：**
- ⚠️ 可能感觉稍慢（但可以通过 CSS 调整）

---

### 方案 B：针对失焦优化 CSS transition

#### 1. 添加更快的失焦收回动画
```css
/* 当前 */
.translation-island__surface {
  transition:
    width 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
    height 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-radius 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* 优化方案：为 idle 模式添加更快的收回 */
.translation-island--idle .translation-island__surface {
  transition:
    width 200ms cubic-bezier(0.4, 0, 0.2, 1),
    height 200ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

**参数说明：**
- **200ms**（从 280ms 减少）- 收回更快
- **cubic-bezier(0.4, 0, 0.2, 1)** - 快速开始，平滑结束
- 对比：展开使用 `(0.2, 0.8, 0.2, 1)` - 缓慢开始，快速结束

**收益：**
- ✅ 失焦收回更响应（200ms vs 280ms）
- ✅ 不同方向使用不同缓动，更自然
- ✅ 符合 Material Design 的 motion 原则

---

### 方案 C：组合优化（推荐）⭐

**同时应用方案 A 和 B：**
1. 移除 `motion: "instant"`，使用动画
2. 为 idle 模式添加更快的 transition
3. 可选：添加专门的失焦收回缓动

```css
/* 通用展开动画（保持不变）*/
.translation-island__surface {
  transition:
    width 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
    height 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-radius 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* idle 模式收回动画（更快）*/
.translation-island--idle .translation-island__surface {
  transition:
    width 220ms cubic-bezier(0.4, 0, 0.2, 1),
    height 220ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

**为什么选 220ms？**
- 280ms（展开）→ 220ms（收回）
- 减少 ~21%，感知上明显更快
- 但不会太快导致突兀（200ms 可能有点快）
- 与 iOS 动画时长接近

---

## 实施计划

### Phase 1: 修改 BallWindow.tsx（5 分钟）
```typescript
// 第 798 行
if (!focused && shouldCollapseActions) {
  void transitionMode("idle", { reason: "focus-loss" });
}
```

### Phase 2: 优化 CSS transition（5 分钟）
```css
/* src/index.css，在 .translation-island__surface 后添加 */
.translation-island--idle .translation-island__surface {
  transition:
    width 220ms cubic-bezier(0.4, 0, 0.2, 1),
    height 220ms cubic-bezier(0.4, 0, 0.2, 1),
    border-radius 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Phase 3: 测试（10 分钟）
1. 展开灵动岛到 actions 模式
2. 点击外部失焦
3. 观察收回动画是否流畅且快速
4. 展开到 full 模式测试
5. 确保没有闪烁或卡顿

**总时间：~20 分钟**

---

## 预期效果

### 优化前
- Actions 失焦：瞬间收回（无动画）❌
- Full 失焦：280ms 动画
- 体验：不够统一

### 优化后
- Actions 失焦：220ms 流畅动画 ✅
- Full 失焦：220ms 流畅动画 ✅
- 体验：统一且响应快

---

## 缓动曲线对比

### 展开动画（保持）
```
cubic-bezier(0.2, 0.8, 0.2, 1)
  ▁▁▂▃▅▆▇███
慢启动 → 快速完成
```

### 收回动画（新增）
```
cubic-bezier(0.4, 0, 0.2, 1)
  ███▇▆▅▃▂▁▁
快启动 → 平滑减速
```

**设计理念：**
- 展开：给用户准备时间（慢启动）
- 收回：立即响应用户操作（快启动）

---

## 参考

### Material Design Motion
- **Entering:** 慢启动，快结束
- **Exiting:** 快启动，平滑结束
- 标准时长：200-300ms

### iOS Dynamic Island
- 收回动画：~200ms
- 快速响应用户操作

### macOS 动画
- 窗口最小化：250ms
- 收回通常比展开快 20-30%

---

## 风险评估

### 低风险 ✅
- CSS 改动很小
- 不影响现有功能
- 容易回滚

### 潜在问题
1. **感觉太快** - 调整为 240ms
2. **感觉太慢** - 调整为 200ms
3. **与其他动画不协调** - 微调缓动曲线

---

## 总结

**推荐实施方案 C（组合优化）：**

1. ✅ 移除 `motion: "instant"`
2. ✅ 添加 220ms 的 idle 收回动画
3. ✅ 使用优化的缓动曲线
4. ✅ 时间投入小（20 分钟）
5. ✅ 收益明显（更流畅的失焦体验）

要开始实施吗？
