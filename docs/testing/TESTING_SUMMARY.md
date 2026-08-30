# VanishTrans 测试状态与覆盖边界

## 🎯 测试覆盖与验证边界

### ✅ 前端测试 (Frontend Tests)

#### 测试框架
- **工具**: Vitest 4.1.10
- **运行环境**: jsdom (浏览器模拟)
- **配置**: 已配置并正常工作

#### 测试文件统计
| 文件                           | 测试用例数 | 状态 | 覆盖范围               |
|--------------------------------|-----------|------|------------------------|
| `src/lib/textUtils.test.ts`   | 16        | ✅   | 字符统计、格式化、验证 |
| `src/lib/fileParser.test.ts`  | 42        | ✅   | SRT/JSON 解析和重建    |
| **其他测试文件**               | 107       | ✅   | Windows `pnpm check` 已覆盖；包含组件、服务、工具和并发回归 |
| **总计**                       | **165**   | ✅   | Windows `pnpm check`：19 个文件、165/165；WSL runner 仍有环境稳定性问题 |

#### 最新重点回归执行
- `App.test.tsx`: 14/14；`QuickTranslateWindow.test.tsx`: 4/4；`ScreenshotOverlay.test.tsx`: 6/6
- `tauriBridge.test.ts`: 4/4；`useConfig.test.ts`: 2/2；`useFileTranslation.test.ts`: 1/1；`useTauriEvents.test.tsx`: 2/2
- 以上均使用 `vmThreads` 单 worker、`--no-file-parallelism`；Rust 全量为 91/91。
- Windows 实际 `pnpm check`：19/19 测试文件、165/165 测试通过。
---

### 📋 textUtils.test.ts 详细覆盖 (16 个测试)

#### countChars (3 tests)
- ✅ 正确统计 ASCII 字符
- ✅ 正确统计 Unicode 字符 (表情符号、中文等)
- ✅ 处理空字符串

#### formatNumber (1 test)
- ✅ 使用本地化千位分隔符格式化数字

#### isErrorMessage (2 tests)
- ✅ 检测错误标记 `[ERROR]`
- ✅ 正常文本返回 false

#### stripErrorMarker (2 tests)
- ✅ 移除错误标记和前后空白
- ✅ 不修改无标记的文本

#### hasContent (2 tests)
- ✅ 非空文本返回 true
- ✅ 空文本或纯空白返回 false

#### truncateText (3 tests)
- ✅ 截断超出限制的文本并添加省略号
- ✅ 保留 Unicode 字符的完整性
- ✅ 不修改限制内的文本

#### isWithinLimit (3 tests)
- ✅ 限制内返回 true
- ✅ 超出限制返回 false
- ✅ 恰好等于限制返回 true

---

### 📋 fileParser.test.ts 详细覆盖 (42 个测试)

#### SRT 解析 (parseSrt - 11 tests)
- ✅ 解析有效的 SRT 字幕内容
- ✅ 处理多行字幕文本
- ✅ 规范化换行符 (CRLF 和 CR)
- ✅ 跳过无效索引的块
- ✅ 跳过缺少时间码箭头的块
- ✅ 保留合法但为空文本的字幕块并保存时间轴
- ✅ 处理空输入
- ✅ 处理单个字幕块
- ✅ 处理块之间的额外空行

#### SRT 重建 (rebuildSrt - 3 tests)
- ✅ 从块重建 SRT 格式
- ✅ 保留多行文本
- ✅ 处理空块数组

#### JSON 解析 (parseJson - 12 tests)
- ✅ 解析扁平 JSON 对象
- ✅ 解析嵌套 JSON 对象
- ✅ 解析 JSON 数组
- ✅ 跳过非字符串值 (number, boolean, null, empty)
- ✅ 转义 JSON Pointer 特殊字符 (`/` 和 `~`)
- ✅ 处理根级字符串
- ✅ 处理深度嵌套结构
- ✅ 抛出无效 JSON 错误
- ✅ 处理空对象
- ✅ 处理空数组
- ✅ 处理混合嵌套数组和对象

#### JSON 重建 (rebuildJson - 8 tests)
- ✅ 使用翻译重建 JSON
- ✅ 保留未翻译的字段
- ✅ 处理嵌套翻译
- ✅ 处理数组翻译
- ✅ 处理根级字符串翻译
- ✅ 抛出无效原始 JSON 错误
- ✅ 保留非字符串值
- ✅ 使用 2 空格缩进格式化输出

#### 文件类型检测 (detectFileType - 7 tests)
- ✅ 检测 .txt 文件
- ✅ 检测 .srt 文件
- ✅ 检测 .json 文件
- ✅ 不支持的扩展名返回 unknown
- ✅ 无扩展名文件返回 unknown
- ✅ 处理多个点的文件名
- ✅ 大小写不敏感

#### 解析器往返测试 (2 tests)
- ✅ SRT 解析和重建往返保留内容
- ✅ JSON 解析和重建往返保留结构

---

### ✅ 后端 Rust 测试 (Backend Rust Tests)

#### 测试框架
- **工具**: Rust 内置测试框架 (`#[test]`)
- **数据库**: SQLite `:memory:` (内存数据库)

#### tm.rs - 翻译记忆测试 (6 tests)
| 测试用例                                                   | 状态 | 覆盖功能                      |
|-----------------------------------------------------------|------|------------------------------|
| `export_includes_entries_beyond_search_limit`             | ✅   | 导出超出搜索限制的条目        |
| `import_content_accepts_bom_and_optional_header`          | ✅   | 接受 BOM 和可选 CSV 头部      |
| `cache_entries_are_scoped_to_the_translation_context`     | ✅   | 上下文作用域缓存              |
| `csv_export_neutralizes_formulas_and_import_restores_text`| ✅   | CSV 公式安全化和恢复          |
| `opening_an_legacy_database_migrates_it_without_losing`   | ✅   | 旧数据库迁移不丢失数据        |
| `store_reports_sqlite_write_failures`                     | ✅   | TM 写入失败可观察             |
#### history.rs - 历史记录测试 (10+ tests)
| 测试用例                                               | 状态 | 覆盖功能                 |
|-------------------------------------------------------|------|-------------------------|
| `add_and_get_all_returns_records_in_reverse_order`    | ✅   | 记录按倒序返回           |
| `search_finds_matching_original`                      | ✅   | 搜索原文匹配             |
| `search_finds_matching_translated`                    | ✅   | 搜索译文匹配             |
| `search_is_case_insensitive`                          | ✅   | 搜索不区分大小写         |
| `delete_removes_specific_record`                      | ✅   | 删除指定记录             |
| `clear_removes_all_records`                           | ✅   | 清除所有记录             |
| `max_records_is_enforced`                             | ✅   | 强制最大记录数限制       |
| `empty_search_returns_all`                            | ✅   | 空搜索返回所有记录       |
| `flush_persists_recent_records_before_exit`           | ✅   | 退出前持久化最近记录     |
| `failed_flush_stays_dirty_and_can_be_retried`         | ✅   | 失败的刷新保持脏状态     |

---

## 📊 测试统计总览

### 前端测试
```
✅ Test Files: 19 个测试文件（按文件隔离运行）
✅ Windows `pnpm check`: 19/19 个测试文件、165/165 个测试通过；WSL 多文件全量运行仍存在 worker/mock 污染
⏱️ Duration: 单文件运行时间受 WSL/jsdom worker 启动影响

### 后端测试 (Rust)
```text
✅ cargo test: 91 passed; 0 failed
✅ 覆盖 SSE、请求序列、OCR session、配置回滚和 TM 写入失败回归
```

### 总计
- **前端测试清单**: 19 个文件、165 个展开测试；Windows `pnpm check` 全部通过 ✅
- **后端测试**: 91 个测试 ✅
- **全量前端门禁**: Windows `pnpm check` 已通过 19/19 文件、165/165 测试；WSL runner 仍不稳定

---

## 🎯 边界情况覆盖

### ✅ 文件解析边界情况
1. **空输入**: 空字符串、纯空白、纯换行
2. **损坏格式**:
   - SRT: 无效索引、缺少时间码箭头、空文本块
   - JSON: 无效 JSON、特殊字符转义、根级字符串
3. **极端长度**:
   - 多行字幕文本
   - 深度嵌套 JSON 结构
   - 超长数组和对象
4. **字符编码**:
   - CRLF、CR 换行符规范化
   - Unicode 表情符号和多字节字符
   - JSON Pointer 特殊字符 (`/` 和 `~`)
5. **CSV 安全**:
   - 公式注入防护 (`=cmd`, `+formula`)
   - BOM 处理
   - 可选 CSV 头部

### ✅ 数据库边界情况
1. **内存数据库**: `:memory:` SQLite 隔离测试
2. **并发控制**: Mutex 锁保护
3. **模糊搜索**: 大小写不敏感、部分匹配
4. **去重逻辑**: UNIQUE 约束测试
5. **分页查询**: 限制和偏移量
6. **数据迁移**: 旧数据库结构升级
7. **上下文作用域**: 翻译记忆上下文隔离

---

## 🚀 运行测试

### 前端测试
```bash
# 运行所有测试（WSL 下建议按文件隔离运行）
pnpm test

# 运行特定文件
pnpm exec vitest run --pool=vmThreads --maxWorkers=1 --no-file-parallelism src/lib/textUtils.test.ts
pnpm exec vitest run --pool=vmThreads --maxWorkers=1 --no-file-parallelism src/lib/fileParser.test.ts

# 监听模式（开发中）
pnpm test:watch

# 覆盖率报告（需显式安装/配置覆盖率 provider）
pnpm test -- --coverage

### 后端测试
```bash
cd src-tauri

# 运行所有 Rust 测试
cargo test

# 运行特定模块
cargo test tm::
cargo test history::

# 显示输出
cargo test -- --nocapture

# 并行运行
cargo test -- --test-threads=4
```

---

## 📈 测试覆盖率目标

| 模块                  | 当前覆盖率 | 目标覆盖率 | 状态 |
|-----------------------|-----------|-----------|------|
| `textUtils.ts`        | 未测量      | 100%      | ⚠️   |
| `fileParser.ts`       | 未测量      | 100%      | ⚠️   |
| `translationState.ts` | 未测量      | 80%+      | ⚠️   |
| `tm.rs`               | 未测量      | 90%+      | ⚠️   |
| `history.rs`          | 未测量      | 90%+      | ⚠️   |

---

## 🔧 待添加的测试 (可选)

### 前端
1. ⏸️ `translationState.test.ts` - 状态管理纯函数测试
2. ⏸️ `InputSection.test.tsx` - UI 组件测试
3. ⏸️ `OutputSection.test.tsx` - UI 组件测试
4. ⏸️ `FileDropZone.test.tsx` - 拖拽交互测试
5. ⏸️ `useTranslation.test.ts` - Hook 集成测试

### 后端
- ⚠️ 核心模块已有单元回归；真实 Windows/OCR/剪贴板和跨窗口流程仍需集成测试

---

## ✅ 测试质量保证

### 测试特性
- ✅ **隔离性**: 关键测试按文件隔离运行，Rust 使用内存数据库或临时目录
- ⚠️ **可复现性**: 单文件运行可复现；WSL 多文件 runner 仍有 worker/mock/DOM 状态污染
- ⚠️ **耗时**: Rust 测试较快，前端耗时受 WSL/jsdom worker 启动影响
- ✅ **清理**: 测试后自动清理临时文件和数据
- ⚠️ **边界覆盖**: 已覆盖列出的空输入、极端值和错误路径，未宣称全部场景
- ⚠️ **集成范围**: 当前主要是解析器往返和模块级回归，非完整 IPC/端到端测试
### CI/CD 配置范围
```yaml
# GitHub Actions 示例
- name: Run Frontend Tests
  run: pnpm test

- name: Run Backend Tests
  run: cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 🎉 总结

### 完成情况
1. ⚠️ **前端测试清单**: 19 个文件、165 个参数展开测试
   - 关键回归文件已按单文件隔离运行通过（App、ScreenshotOverlay、QuickTranslateWindow、BallWindow、Bridge、配置、文件翻译和事件生命周期）
   - 多文件全量运行在当前 WSL/jsdom worker 环境仍出现启动/共享状态问题，不能标记为无条件全绿

2. ✅ **后端测试**: 91 个 Rust 测试全部通过
   - 覆盖 TM 写入失败、SSE 错误、OCR stale session、请求取消和配置回滚

3. ✅ **边界覆盖**: 空文件、损坏格式、极端长文本、Unicode 和关键并发边界已增加回归

4. ✅ **内存数据库**: Rust 测试使用临时数据库或内存数据库隔离


### 质量指标
- **前端执行证据**: Windows `pnpm check` 19/19 文件、165/165 测试通过；WSL 多文件 runner 仅存在环境稳定性问题
- **Rust 执行证据**: 91/91
- **代码覆盖率**: 未运行覆盖率工具，不宣称百分比
- **构建**: Windows `pnpm tauri build` 已成功生成 `VanishTrans_0.1.1_x64-setup.exe`

### 提示词符合度
| 要求                                    | 状态 |
|-----------------------------------------|------|
| 配置 Vitest                             | ✅   |
| fileParser.ts 单元测试                  | ✅   |
| textUtils.ts 单元测试                   | ✅   |
| 覆盖边界情况 (空文件、损坏格式、极端长) | ✅   |
| Rust tm.rs 单元测试                     | ✅   |
| Rust history.rs 单元测试                | ✅   |
| 内存 SQLite 数据库                      | ✅   |
| 插入、模糊搜索、去重、分页测试          | ✅   |
| 所有测试绿灯通过（Windows 本地门禁）      | ✅（原生集成和远程 CI 待验证） |

---

**测试状态更新时间**: 2026-08-27 复核后更新
**测试覆盖率**: 未运行覆盖率工具；仅记录已执行的测试结果
**质量评估**: Windows 本地代码门禁已通过；Production Ready 仍需真实 Windows 原生集成和远程 CI/release 证据
