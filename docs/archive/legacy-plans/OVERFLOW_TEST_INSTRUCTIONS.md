# Tauri 窗口溢出测试

## 快速验证方法

在当前的 `pnpm tauri dev` 环境中：

### 测试 1：验证 overflow 渲染

1. 打开浏览器开发者工具（F12）
2. 在 Console 中运行：

```javascript
// 测试：让内容溢出当前窗口
document.body.style.overflow = 'visible';
document.documentElement.style.overflow = 'visible';

// 创建一个大的测试元素
const test = document.createElement('div');
test.style.cssText = `
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 400px;
  height: 400px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 20px;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 24px;
  font-weight: bold;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  cursor: pointer;
`;
test.textContent = 'OVERFLOW TEST - Click me!';
test.onclick = () => alert('Clicked!');
document.body.appendChild(test);
```

### 预期结果

**✅ 成功（方案C可行）：**
- 你能看到完整的 400x400 紫色方块
- 方块完全显示，没有被窗口裁剪
- 点击方块会弹出 alert

**❌ 失败（方案C不可行）：**
- 方块被窗口边界裁剪
- 只能看到一部分（116x42 范围内）
- 溢出部分不可见或不可点击

### 测试 2：验证点击穿透

如果测试 1 成功，继续测试透明区域穿透：

```javascript
// 让整个窗口背景透明且可穿透
document.body.style.pointerEvents = 'none';
document.documentElement.style.pointerEvents = 'none';

// 但测试元素可点击
test.style.pointerEvents = 'auto';
```

尝试点击：
1. 测试元素（应该响应）
2. 测试元素外的透明区域（应该穿透到桌面）

---

## 测试结果记录

### Windows 11 + Tauri + WebView2

**Overflow 渲染：** ✅ / ❌

**点击事件：** ✅ / ❌

**透明穿透：** ✅ / ❌

---

## 如果全部 ✅

方案C完全可行！继续实施：

1. 固定窗口为 116x42
2. 使用 `overflow: visible`
3. 内容自由缩放 116px ↔ 420px
4. 纯 CSS Spring 动画，无需调整原生窗口

## 如果任何 ❌

回退到优化版方案B：

1. 保持当前的居中对齐方案
2. 微调动画参数
3. 接受短暂的尺寸不匹配
