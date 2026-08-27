# 动画性能优化方案

## 当前状态分析

### 已经存在的 will-change
```css
/* 已优化 ✓ */
.translation-island__surface {
  will-change: transform, width, height, border-radius;
}

.translation-island__full {
  will-change: opacity, transform;
}

.translation-island__full .app-shell {
  will-change: contents;
}

.translation-island__actions button {
  will-change: transform;
}
```

### 需要添加 will-change 的元素

#### 1. 灵动岛核心内容区域
```css
.translation-island__core {
  /* 当前：无 will-change */
  /* 建议：will-change: opacity, transform; */
}
```

#### 2. 状态图标和活动指示器
```css
.translation-island__state-icon {
  /* 当前：无 will-change */
  /* 建议：will-change: transform; （有旋转动画）*/
}

.translation-island__activity {
  /* 当前：无 will-change */
  /* 建议：will-change: transform; （有脉冲动画）*/
}
```

#### 3. 抽屉和遮罩
```css
.drawer-backdrop {
  /* 当前：无 will-change */
  /* 建议：will-change: opacity; （有淡入动画）*/
}

.overlay-drawer {
  /* 当前：无 will-change */
  /* 建议：will-change: transform, opacity; */
}
```

#### 4. 设置面板动画元素
```css
.settings-section {
  /* 当前：无 will-change */
  /* 建议：will-change: opacity, transform; （fadeSlideUp 动画）*/
}

.settings-tabs button::after {
  /* 当前：无 will-change */
  /* 建议：will-change: opacity, transform; */
}
```

---

## 优化策略

### 原则
1. **只在动画元素上添加** - 避免过度使用
2. **动画结束后移除** - 防止内存浪费
3. **关键动画优先** - 灵动岛 > 其他 UI

### 风险
- ⚠️ 过度使用 `will-change` 会增加内存占用
- ⚠️ 需要在动画结束后移除，否则适得其反

### 缓解措施
- ✅ 只在真正有动画的元素上添加
- ✅ 使用 CSS 动画事件清理（`animationend`, `transitionend`）
- ✅ 对于持续动画（如旋转图标），保持 `will-change`

---

## 实施计划

### Phase 1: 核心动画优化（高优先级）
添加 `will-change` 到关键动画元素：
- ✅ 灵动岛表面 (已有)
- ✅ 灵动岛全屏内容 (已有)
- ⚪ 灵动岛核心内容
- ⚪ 状态图标（旋转动画）
- ⚪ 活动指示器

### Phase 2: UI 动画优化（中优先级）
- ⚪ 抽屉和遮罩
- ⚪ 设置面板动画

### Phase 3: 动态清理（可选）
使用 React 在动画结束后清理：
```typescript
useEffect(() => {
  const element = elementRef.current;
  if (!element) return;

  const handleAnimationEnd = () => {
    element.style.willChange = 'auto';
  };

  element.addEventListener('animationend', handleAnimationEnd);
  element.addEventListener('transitionend', handleAnimationEnd);

  return () => {
    element.removeEventListener('animationend', handleAnimationEnd);
    element.removeEventListener('transitionend', handleAnimationEnd);
  };
}, []);
```

---

## CSS 改动清单

### 1. 灵动岛核心内容
```css
.translation-island__core {
  /* 添加 */
  will-change: opacity, transform;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
```

### 2. 状态图标（旋转动画）
```css
.translation-island__state-icon {
  /* 添加 */
  will-change: transform;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
```

### 3. 活动指示器
```css
.translation-island__activity {
  /* 添加 */
  will-change: transform;
}

.translation-island__activity i {
  /* 添加 */
  will-change: transform;
  backface-visibility: hidden;
}
```

### 4. 抽屉动画
```css
.drawer-backdrop {
  /* 添加 */
  will-change: opacity;
}

.overlay-drawer {
  /* 添加 */
  will-change: transform, opacity;
  backface-visibility: hidden;
}
```

### 5. 设置面板
```css
.settings-section {
  /* 添加 */
  will-change: opacity, transform;
  backface-visibility: hidden;
}
```

---

## 性能指标

### 优化前
- 动画帧率：~55-60 FPS
- 布局抖动：偶尔发生
- 重绘/重排：中等

### 优化后（预期）
- 动画帧率：稳定 60 FPS
- 布局抖动：减少
- 重绘/重排：最小化（GPU 加速）

---

## 测试计划

1. **基础测试**
   - 灵动岛展开/收起流畅度
   - 拖拽是否流畅
   - 设置面板打开动画

2. **性能测试**
   - Chrome DevTools Performance 录制
   - 检查 FPS 是否稳定 60
   - 检查内存使用是否正常

3. **兼容性测试**
   - Windows 10/11
   - 不同 DPI 缩放

---

## 时间估算

- Phase 1 (核心动画): 30 分钟
- Phase 2 (UI 动画): 20 分钟
- 测试: 20 分钟

**总计：~1 小时**

---

## 注意事项

### ⚠️ will-change 最佳实践

**DO：**
✅ 只在真正需要的元素上使用
✅ 动画结束后移除
✅ 使用具体的属性（如 `transform`）而不是 `all`

**DON'T：**
❌ 不要在所有元素上使用
❌ 不要永久保留（除非持续动画）
❌ 不要使用 `will-change: all`

### 📚 参考资源
- [MDN: will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)
- [Google: Stick to Compositor-Only Properties](https://web.dev/stick-to-compositor-only-properties-and-manage-layer-count/)
