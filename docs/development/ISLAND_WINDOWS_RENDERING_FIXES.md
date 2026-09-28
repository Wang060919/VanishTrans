# Windows 灵动岛动画与失焦绘制问题记录

记录日期：2026-09-28。适用实现：Tauri 2、Tao 0.35.3、WebView2。

## 1. 收起动画右侧闪现被裁断的小岛残片

**现象**：收起过程中，窗口右侧短暂出现小岛左侧约三分之一的黑色残片，右边缘被裁断。浏览器预览正常不能证明原生窗口正常。

**定位判断**：原生窗口缩小、移动与 WebView2 更新之间存在呈现不同步。此前采用单次 `SetWindowPos` 同时更新位置和尺寸、禁用旧像素复制，以及等待 CSS 动画完成和后续绘制帧，用户仍报告残片；这些措施单独不足以解决问题。未用图形跟踪工具确认具体发生在哪个合成阶段。

**有效改动**：Windows 上保留展开后的原生窗口和 WebView2 画布，收起时只让网页内的小岛变形。动画结束后调用 `SetWindowRgn`，将窗口可见及鼠标响应区域限制到小岛矩形；不再在收起末尾缩小和移动原生画布。重新展开前解除裁剪，并保持较大的原生尺寸。非 Windows 平台继续走原来的尺寸调整路径。

相关入口：

- `src/features/ball/ballCollapse.ts`：等待表面动画结束，发送 `retainSurface: true`。
- `src/features/ball/ballTransition.ts`、`ballGeometry.ts`：区分视觉状态与原生画布状态，处理重开及停靠坐标。
- `src/features/ball/ballSurfaceSettlement.ts`：等待表面动画与绘制帧。
- `src-tauri/src/commands/window_bounds.rs`：`retain_surface` 设置窗口区域；`set_bounds` 解除裁剪并按需调整边界。

**验证状态**：用户已明确确认该残片问题修复。固定画布方案随后暴露了下面的原生绘制问题。

## 2. 打开或失焦时出现系统边框、白角及顶部横条

**现象**：打开小岛时闪现 Windows 标题栏和边框；后续截图分别显示小岛失焦后的浅色直角背景，以及主界面失焦时展开岛背后的浅色横条。

**源码依据及判断**：Tao 的无边框顶层窗口仍保留标题栏等样式，主要通过 `WM_NCCALCSIZE` 隐藏边框。区域切换会触发系统窗口消息和重绘，而 Tao 的 `WM_NCACTIVATE` 分支仍调用 `DefWindowProc`。因此仅设置 `decorations: false`，或只清除样式，不能充分控制失焦时的非客户区绘制。这条路径与截图吻合；最终修复已由用户实机确认。

修复分两层：

1. `window_bounds.rs` 中的 `ensure_frameless` 在区域切换前清除标题栏、系统按钮和边框样式，用 `SWP_FRAMECHANGED` 刷新，保留位置、尺寸、激活状态和层级。用户后续截图证明：仅这一层仍有白角、横条。
2. 新增 `src-tauri/src/commands/island_frame.rs`，在 `lib.rs` 的初始化阶段、窗口所属 UI 线程中，仅为 `ball` 安装窗口子类处理。`WM_NCPAINT` 返回 0，阻止系统边框绘制；`WM_NCACTIVATE` 通过 `DefSubclassProc` 继续交给 Tao，但将 `lParam` 设为 -1，禁止默认非客户区重绘，保留焦点 bookkeeping 和事件。其他消息正常传递，`WM_NCDESTROY` 时移除处理。

不能直接吞掉激活/焦点消息，否则可能破坏失焦自动收起。子类必须在窗口所属线程安装，不要从任意后台线程调用。保持固定画布方案，不要为消除白条重新引入收起末尾的缩窗路径。

**验证状态**：最新一轮 127 项 Rust 测试通过，包括真实隐藏 HWND 的区域/激活检查，以及新增的消息链检查：边框绘制被阻止，激活消息携带 -1，获得和失去焦点消息仍正常下传。自动测试没有覆盖 WebView2 与桌面合成的最终像素。2026-09-28，用户进一步反馈“都修复了”，确认收起残片，以及小岛失焦和主界面失焦场景中的原生边框、白角和顶部横条均已解决。此结论来自用户实机反馈，不代表已逐项验证所有缩放比例和多显示器组合。

复测应覆盖：打开后点击桌面、小岛失焦、主界面失焦、反复展开收起，以及不同缩放比例和左右停靠。分别观察白角、顶部横条、系统标题栏是否消失，并确认外部区域可点击、自动收起正常、旧残片不回归。

参考：[WM_NCACTIVATE 的 -1 参数](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-ncactivate)、[SetWindowSubclass 的线程与生命周期约束](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-setwindowsubclass)、[SetWindowRgn 的区域坐标与所有权](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn)。

## 3. 后续补充：首次显示、胶囊四角与截图隐藏

- **迷你窗灰角**：移除初始化时的 Mica/Acrylic 和冲突的 DWM 外框设置；`quick_frame.rs` 负责原生圆角区域。`island_frame` 现同时安装到 `ball` 和 `quick`，并在安装后清理边框样式。迷你窗灰角修复已获用户确认。
- **悬浮球偶发白角**：运行时原生探针发现，无边框样式已生效，但收起后的区域仍是矩形，四角均可命中。新增 `ball_region.rs`，首次显示前及 `retain_surface` 收起路径均采用胶囊裁剪；继续保留大画布，不改变前端动画时序。第 1 节的矩形裁剪是早期实现，当前已替换为胶囊区域。
- **截图时仍显示灵动岛**：后台 `hide()` 只是向主线程排队；原生无激活恢复又可能绕过 Tao 可见性缓存，使后续 `hide()` 不执行。`screenshot_visibility.rs` 先更新框架隐藏状态，再同步取得 HWND、执行原生 `SW_HIDE` 并确认不可见，最后等待 `DwmFlush`。共享截图入口仅在准备成功后采集，失败时取消会话并恢复原可见状态。
- **回归边界**：原生测试覆盖启动/收起实际入口、四角与内容区域、100%–200% 缩放、左中右停靠、重复恢复后隐藏及位置/区域保持。最终完整检查通过 136 个 Rust 测试、199 个前端测试，以及架构、命令清单、TypeScript、ESLint；Windows 调试构建成功。
- **仍需实窗验收**：新增胶囊裁剪和截图隐藏修复尚未完成更新后桌面像素复验。应重启新构建，测试冷启动、反复展开收起、截图按钮/快捷键以及取消后再次截图；不能将上述自动测试结果视为这些场景的用户确认。
