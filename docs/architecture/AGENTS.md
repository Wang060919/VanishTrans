# VanishTrans Agent Specification

## Tech Stack
Tauri v2 + React 18 + TypeScript + TailwindCSS + Rust (rusqlite/reqwest/Windows-OCR)

## Directory Structure
```
src/                          # Frontend
├── features/                 # UI modules (MainWindowApp, QuickTranslateWindow, TmPanel, etc.)
├── hooks/                    # React hooks (useTranslation, useConfig)
├── services/tauriBridge.ts   # **All Tauri IPC calls centralized here**
├── types.ts                  # Shared TS interfaces
└── components/               # Reusable UI components

src-tauri/src/               # Backend
├── commands.rs              # Tauri command definitions
├── translation/             # Translation logic
├── tm/                      # Translation memory (SQLite)
├── ocr/                     # Windows OCR integration
└── config.rs                # Configuration management
```

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

## Wire Format
- Rust `base_url` (snake_case) → TS `baseUrl` (camelCase) at bridge boundary
- TmEntry/TmStats keep snake_case fields matching Rust output
- All commands throw `CommandError { code, message }` on failure

## Dev Commands
```bash
pnpm install              # Install deps
pnpm tsc --noEmit         # TS check
pnpm test                 # Frontend tests (Vitest)
pnpm tauri dev            # Dev mode
cargo test --manifest-path=src-tauri/Cargo.toml  # Rust tests
```
