# 提交计划

## Step 1: 添加新实现文件
git add src/features/islandModel.ts
git add src/features/islandModel.test.ts
git add src/features/islandTransitionCoordinator.ts
git add src/features/islandTransitionCoordinator.test.ts
git add src/features/ball/

## Step 2: 添加所有修改的文件
git add src-tauri/src/
git add src/

## Step 3: 创建提交
git commit -m "fix: 修复 Windows 标题栏问题并重构动画架构

核心修复：
- 移除 SetWindowRgn 和 Win32 动画，修复失焦时出现标题栏的问题
- 参考 RustyIsland (Tauri v2) 的最佳实践，完全使用 Tauri 标准 API
- 简化 set_ball_window_bounds，移除 duration_ms 参数

架构重构：
- 提取 islandModel 和 islandTransitionCoordinator 模块
- 从 JS 驱动动画改为 CSS 过渡（性能更好）
- 优化窗口尺寸为 720×380（更符合灵动岛视觉）

Bug 修复：
- 修复 React 组件内存泄漏（AnimatedList, ClickSpark）
- 修复 Promise 拒绝处理（ScreenshotOverlay, MainWindowApp）
- 改进类型安全（any → unknown）

新功能：
- 嵌入模式底部动作按钮（复制、OCR、TM）
- TM 面板文件大小验证（10MB 限制）

测试：
- 更新所有测试匹配新架构
- 添加 StrictMode 兼容性测试
- 添加转场协调器测试"

## Step 4: 查看提交（可选）
git show --stat

## Step 5: 推送（如果需要）
git push origin main
