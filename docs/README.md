# VanishTrans 文档入口

## 当前维护入口

- [项目 README](../README.md)：功能、安装与开发。
- [根 AGENTS.md](../AGENTS.md)：工程规则及 Tauri 命令清单，唯一维护入口。
- [当前架构](architecture/ARCHITECTURE.md)：模块职责、请求状态约束、原生窗口边界和验证入口。

## 历史记录

以下文档保留当时的过程、计数与结论，不表示当前源码或测试状态：

- [重构概述](architecture/REFACTORING_SUMMARY.md)
- [深度重构报告](architecture/REFACTORING_FINAL.md)
- [测试总结](testing/TESTING_SUMMARY.md)
- [重构检查表](testing/REFACTORING_CHECKLIST.md)
- [四项验证记录](development/FOUR_POINTS_VERIFICATION.md)
- [历史完成总结](development/COMPLETE_SUMMARY.md)
- `archive/`：旧计划、设计资料和视觉参考。

当前验收请执行 `pnpm check` 和 `pnpm check:rust`，并按改动范围补充 Windows 桌面测试。
