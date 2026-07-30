# BallWindow 重构方案

## 当前问题
- BallWindow.tsx 有 894 行代码
- 包含 27+ 个 refs
- 包含多个不同职责的逻辑
- 难以维护和测试

## 重构目标
- 将 BallWindow 拆分为多个职责单一的 hooks
- 每个 hook < 200 行
- 更容易测试
- 更好的代码组织

---

## 拆分方案

### 1. useBallTransition.ts
**职责：** 管理灵动岛的转场动画和窗口调整

**状态：**
- `modeRef` - 当前模式
- `nativeModeRef` - 原生窗口模式
- `nativeTargetModeRef` - 目标模式
- `transitionCoordinator` - 转场协调器

**方法：**
- `runTransition()` - 执行转场
- `commitPresentation()` - 提交展示状态
- `requestTransition()` - 请求转场

**依赖：**
- islandModel
- islandTransitionCoordinator
- Tauri window APIs

---

### 2. useBallDrag.ts
**职责：** 处理灵动岛的拖拽交互

**状态：**
- `pointerOriginRef` - 指针起始位置
- `draggingRef` - 是否正在拖拽
- `pointerCaptureTargetRef` - 捕获目标
- `anchorPositionRef` - 锚点位置
- `dockSide` / `dockSideRef` - 停靠边

**方法：**
- `handlePointerDown()` - 处理按下
- `handlePointerMove()` - 处理移动
- `handlePointerUp()` - 处理释放

**依赖：**
- Tauri window APIs
- saveBallPosition

---

### 3. useBallActions.ts
**职责：** 处理灵动岛的动作（复制、翻译、截图等）

**状态：**
- `busyAction` / `busyActionRef` - 当前动作
- `expectingTranslationRef` - 是否期待翻译

**方法：**
- `handleCopy()` - 处理复制
- `handleTranslate()` - 处理翻译
- `handleScreenshot()` - 处理截图
- `handlePin()` - 处理固定

**依赖：**
- Tauri invoke APIs
- useBallTransition (请求转场)

---

### 4. useBallStatus.ts
**职责：** 管理灵动岛的状态显示（notice, phase）

**状态：**
- `notice` / `noticeRef` - 通知文本
- `phase` / `phaseRef` - 当前阶段
- `noticeTimerRef` - 通知计时器
- `statusTimerRef` - 状态计时器
- `expectedActivityTimerRef` - 期待活动计时器

**方法：**
- `setNoticeWithTimer()` - 设置带计时器的通知
- `updatePhase()` - 更新阶段
- `clearNotice()` - 清除通知

**依赖：**
- 无（纯状态管理）

---

### 5. useBallEvents.ts
**职责：** 监听并处理外部事件

**事件：**
- `pin-state-changed` - Pin 状态改变
- `translation-state` - 翻译状态改变
- `quick-translate-request` - 快速翻译请求
- `ball-action` - 灵动岛动作

**方法：**
- 设置所有事件监听器
- 清理事件监听器

**依赖：**
- Tauri event APIs
- useBallTransition
- useBallActions
- useBallStatus

---

## 重构后的 BallWindow.tsx 结构

```typescript
export default function BallWindow() {
  // 1. 转场管理
  const {
    presentation,
    commitPresentation,
    requestTransition,
  } = useBallTransition();

  // 2. 拖拽逻辑
  const {
    dockSide,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useBallDrag({
    requestTransition,
  });

  // 3. 动作处理
  const {
    busyAction,
    handleCopy,
    handleTranslate,
    handleScreenshot,
    handlePin,
  } = useBallActions({
    requestTransition,
  });

  // 4. 状态显示
  const {
    notice,
    phase,
    setNoticeWithTimer,
    updatePhase,
  } = useBallStatus();

  // 5. 事件监听
  useBallEvents({
    updatePhase,
    requestTransition,
    setNoticeWithTimer,
    onAction: {
      copy: handleCopy,
      translate: handleTranslate,
      screenshot: handleScreenshot,
    },
  });

  // 6. 主题同步
  useThemeSync();

  // 7. 渲染
  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <TranslationIslandView
        presentation={presentation}
        dockSide={dockSide}
        busyAction={busyAction}
        notice={notice}
        phase={phase}
        onPin={handlePin}
      />
      {presentation.mode === "full" && <MainWindowApp />}
    </div>
  );
}
```

**预期行数：** ~80-100 行

---

## 实施步骤

### Step 1: 创建 useBallStatus.ts (最简单，无依赖)
- 提取 notice, phase 状态
- 提取计时器逻辑
- 编写测试

### Step 2: 创建 useBallTransition.ts (核心逻辑)
- 提取 runTransition 逻辑
- 提取转场协调器
- 保持接口简单

### Step 3: 创建 useBallDrag.ts (依赖 Step 2)
- 提取拖拽相关 refs
- 提取拖拽事件处理
- 调用 requestTransition

### Step 4: 创建 useBallActions.ts (依赖 Step 2)
- 提取动作处理逻辑
- 调用 requestTransition
- 处理 Tauri invoke

### Step 5: 创建 useBallEvents.ts (依赖所有)
- 提取事件监听逻辑
- 连接各个 hooks

### Step 6: 重构 BallWindow.tsx
- 使用新 hooks
- 简化组件
- 测试功能

---

## 风险和注意事项

### 风险
1. **Ref 同步问题** - 多个 hooks 间的 ref 同步可能出错
2. **回调依赖** - useCallback 依赖可能遗漏
3. **性能回归** - 不当的重渲染

### 缓解措施
1. 每完成一个 hook 就测试
2. 保留原始文件备份
3. 使用 git 分支开发

### 测试重点
1. 拖拽是否流畅
2. 转场动画是否正常
3. 失焦隐藏是否正常
4. Pin 功能是否正常
5. 复制/翻译/截图是否正常

---

## 时间估算

- Step 1 (useBallStatus): 1 小时
- Step 2 (useBallTransition): 2 小时
- Step 3 (useBallDrag): 1.5 小时
- Step 4 (useBallActions): 1 小时
- Step 5 (useBallEvents): 1 小时
- Step 6 (重构主组件): 1 小时
- 测试和调试: 1.5 小时

**总计：** ~9 小时

---

## 成功标准

1. ✅ BallWindow.tsx < 150 行
2. ✅ 每个 hook < 200 行
3. ✅ 所有功能正常工作
4. ✅ 没有性能回归
5. ✅ 代码更易理解和维护
