# VanishTrans Agent Specification

## Tech Stack
Tauri v2 + React 18 + TypeScript + TailwindCSS + Rust (rusqlite/reqwest/Windows-OCR)

## Directory Structure
```
src/
├── features/                 # Window views; ball/ owns island state/transitions/dragging
├── hooks/                    # Translation composition, shared session, text/file operations
├── services/tauriBridge.ts    # All Tauri command IPC calls
├── lib/                      # Request identity, file parsing/reassembly, text helpers
├── types.ts                  # Shared wire interfaces
└── components/               # Reusable UI components

src-tauri/src/
├── commands/                 # Tauri commands; translate.rs owns TM/history commits
├── config/                   # Settings, credentials, persistence and request scopes
├── translate.rs              # Provider routing and scoped cancellation facade
├── translate/                # Requests, completion, SSE, Google provider and language helpers
├── tm.rs                     # Translation memory (SQLite)
├── history.rs                # Translation history
├── ocr.rs                    # Windows OCR
└── setup/                    # Shortcuts, tray and clipboard watcher
```

Read [the current architecture](docs/architecture/ARCHITECTURE.md) for ownership,
entry points and concurrency invariants. Refactoring reports describe historical snapshots.

## Tauri Commands (52 total)
<!-- BEGIN TAURI_COMMANDS -->
**Config**: `frontend_ready`, `get_startup_warnings`, `get_api_config`, `set_api_config`, `get_logging_enabled`, `set_logging_enabled`, `log_frontend_message`, `set_hotkeys`, `set_glossary`, `set_free_translation`, `set_max_records`

**Clipboard**: `read_clipboard_safe`, `write_clipboard_safe`, `cleanup_clipboard_text`

**Profile**: `list_service_profiles`, `save_service_profile`, `delete_service_profile`, `apply_service_profile`, `test_connection`

**Translation**: `translate`, `translate_with_direction`, `translate_stream`, `cancel_translation`, `translate_batch`

**History**: `get_history`, `delete_history_record`, `clear_history`

**TM**: `tm_search`, `tm_delete`, `tm_clear`, `tm_stats`, `tm_export`, `tm_import`, `tm_import_content`

**Window**: `hide_window`, `toggle_pin`, `get_pin_state`, `set_ball_window_bounds`, `show_main_window`, `hide_quick_window`, `show_main_with_text`, `quick_frontend_ready`

**Ball**: `translate_clipboard_from_ball`, `start_screenshot_from_ball`, `toggle_ball_show_main`, `toggle_ball`, `save_ball_position`, `get_ball_position`

**OCR**: `get_screenshot_payload`, `cancel_screenshot`, `run_ocr_on_crop`, `finish_ocr`
<!-- END TAURI_COMMANDS -->

## Hard Constraints
1. **NO direct `invoke()` in React components** → All IPC via `src/services/tauriBridge.ts`
2. **File size limit**: ≤200 lines per TS/Rust file (bridge exception: 374 lines)
3. **Strict TypeScript**: NO `any` types in production code
4. **Rust errors**: Tauri commands return `Result<T, CommandError>` with stable `code` and `message` fields
5. **Naming conflicts**: Import bridge functions `as XxxCmd` when local functions have same name

## State Ownership

- Main and quick windows each own a `useTranslationSession`; text and file operations share that window's session.
- Async operations must commit through the session with their request ID. Do not add independent loading/error/result state to operation hooks.
- Request completion is idempotent: IPC return and stream-done can arrive in either order. Cancellation/reset invalidates late results immediately.
- Island native geometry changes go through `IslandTransitionCoordinator`; dragging pauses its queue. Business events request transitions rather than resizing windows directly.
- Backend configuration lives in `config/`; `translate.rs` re-exports existing entry points for compatibility. Provider modules must not write history or TM.

## Wire Format
- Rust `base_url` (snake_case) → TS `baseUrl` (camelCase) at bridge boundary
- TmEntry/TmStats keep snake_case fields matching Rust output
- All commands throw `CommandError { code, message }` on failure

## Dev Commands
```bash
pnpm install              # Install deps
pnpm check               # Architecture/command checks, TS, tests, ESLint
pnpm tsc --noEmit         # TS check
pnpm test                 # Frontend tests (Vitest)
pnpm tauri dev            # Dev mode
cargo test --manifest-path=src-tauri/Cargo.toml  # Rust tests
```

## Maintenance Workflow

- This project is close to complete and is maintained mainly through daily use and bug reports.
- When the user reports a bug, inspect the current implementation, diagnose it, make the smallest necessary fix, and run proportionate verification.
- Do not expand scope, add unrelated features, perform broad refactors, or upgrade dependencies without a clear request.
- Keep the final explanation concise: cause, changes, and verification result.
