# 灵动岛 Full 模式重设计：横向布局

## 🎯 目标
将竖长的翻译窗口改为扁宽的横向布局，更像 Mac 灵动岛

## 📐 当前 vs 新设计

### 当前布局（420x520 竖长）
```
┌──────────────┐
│   [标题栏]    │ 60px
├──────────────┤
│   原文区域    │ 200px
├──────────────┤
│   译文区域    │ 200px
├──────────────┤
│   底部操作    │ 60px
└──────────────┘
  420px 宽
```

### 新布局方案A（720x380 扁宽）
```
┌────────────────────────────────────────┐
│  [标题栏]                               │ 50px
├──────────────────┬────────────────────┤
│                  │                    │
│   原文区域       │    译文区域         │ 280px
│   (左侧)         │    (右侧)          │
│                  │                    │
├──────────────────┴────────────────────┤
│  [操作按钮栏]                           │ 50px
└────────────────────────────────────────┘
        720px 宽
```

### 新布局方案B（800x400 更宽）
```
┌────────────────────────────────────────────────┐
│  VanishTrans  [历史] [设置] [全屏] [关闭]        │ 50px
├──────────────────────┬─────────────────────────┤
│                      │ 译文                     │
│   原文                │                         │ 300px
│                      │                         │
├──────────────────────┴─────────────────────────┤
│  [复制原文] [复制译文] [智能选读] [TM面板]       │ 50px
└────────────────────────────────────────────────┘
        800px 宽
```

---

## 🎨 推荐尺寸

### Mac 灵动岛参考
- **Compact**: 150 x 37
- **Expanded (music)**: 410 x 84 (横向扁平)
- **Expanded (call)**: 371 x 84
- **Full**: 不会展开到很大，保持横向

### VanishTrans 新尺寸建议

| 模式 | 尺寸 | 说明 |
|------|------|------|
| idle | 116 x 42 | 保持不变 ✅ |
| actions | 296 x 60 | 保持不变 ✅ |
| status | 264 x 52 | 保持不变 ✅ |
| **full** | **720 x 380** | 🆕 横向布局 |

---

## 📝 Full 模式内容布局

### 顶部标题栏 (50px)
```tsx
<header className="full-header">
  <div className="brand">
    <VanishMark /> VanishTrans
  </div>
  <div className="actions">
    <button>历史记录</button>
    <button>设置</button>
    <button>全屏</button>
    <button>关闭</button>
  </div>
</header>
```

### 主内容区 (280px 高，左右分栏)
```tsx
<main className="full-content">
  <section className="source-panel">
    <header>
      <select>中文</select>
      <button>粘贴</button>
    </header>
    <textarea placeholder="输入、粘贴或截图..."/>
    <footer>
      0 / 10,000
    </footer>
  </section>

  <div className="divider" />

  <section className="target-panel">
    <header>
      <select>英语</select>
      <button>交换</button>
    </header>
    <div className="result">
      {translationResult}
    </div>
  </section>
</main>
```

### 底部操作栏 (50px)
```tsx
<footer className="full-footer">
  <button><Clipboard /> 复制原文</button>
  <button><Check /> 复制译文</button>
  <button><ScanLine /> 智能选读</button>
  <button><PanelTopOpen /> TM面板</button>
</footer>
```

---

## 🎯 实施步骤

### Step 1: 更新尺寸常量
```typescript
// BallWindow.tsx
const FULL_WIDTH = 720;   // 420 → 720
const FULL_HEIGHT = 380;  // 520 → 380
```

### Step 2: 重构 MainWindowApp.tsx 布局
从竖向改为横向双栏布局

### Step 3: 更新 CSS
```css
.translation-workspace {
  display: grid;
  grid-template-rows: 50px 1fr 50px;  /* 头部 内容 底部 */
  height: 100%;
}

.main-content {
  display: grid;
  grid-template-columns: 1fr auto 1fr;  /* 原文 | 分割线 | 译文 */
  gap: 0;
  overflow: hidden;
}

.source-panel, .target-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;  /* 防止文字溢出 */
}
```

### Step 4: 调整动画
```typescript
// TranslationIslandView.tsx
const ISLAND_GEOMETRY = {
  idle: { width: 116, height: 42, borderRadius: 21 },
  // ...
  full: { width: 720, height: 380, borderRadius: 28 },  // 🆕
};
```

---

## ⚠️ 注意事项

### 1. 响应式布局
宽度足够时才横向，否则竖向：
```css
@media (max-width: 720px) {
  .main-content {
    grid-template-columns: 1fr;  /* 单栏 */
    grid-template-rows: 1fr auto 1fr;
  }
}
```

### 2. 文字滚动
横向布局时，原文和译文可能更容易溢出：
```css
.source-panel textarea,
.target-panel .result {
  overflow-y: auto;  /* 垂直滚动 */
  word-wrap: break-word;
}
```

### 3. 展开动画方向
从 idle 居中展开：
```
Idle (116px)
    ↓
    [====]
    ↓
Full (720px)  // 从中心向左右展开
[================================]
```

---

## 🎨 视觉效果

### 展开动画
```
t=0ms:   [小圆角胶囊]
t=200ms: [====横向拉伸====]
t=400ms: [=====完整窗口=====]
```

### 优势
- ✅ 更像 Mac 灵动岛（横向扩展）
- ✅ 左右对照翻译更直观
- ✅ 屏幕利用率更高（宽屏）
- ✅ 不会遮挡太多垂直空间

---

## 🚀 要开始实施吗？

可以结合前面的 RustyIsland 借鉴方案一起做：

1. 改横向布局（720x380）
2. 瞬间窗口调整 + CSS 动画
3. 一次性解决尺寸和抖动问题

预计 **1-1.5 小时**完成。
