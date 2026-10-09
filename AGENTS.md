# VanishTrans Agent Specification

## Tech Stack
Tauri v2 + React 18 + TypeScript + TailwindCSS + Rust (rusqlite/reqwest/Windows-OCR)

## Directory Structure
```
src/
├── features/                 # Window views
│   ├── ball/                 # Island state, transitions and dragging
│   ├── settings/             # Settings tabs (API, glossary, hotkeys, privacy, TM)
│   └── translate/            # Input/output sections and file drop zone
├── hooks/                    # Translation composition, shared session, text/file operations
├── services/tauriBridge.ts   # All Tauri command IPC calls
├── lib/                      # Request identity, file parsing/reassembly, text helpers
├── layouts/                  # Main window layout and header
├── components/               # Reusable UI components
├── styles/                   # Per-window stylesheets and design tokens
├── assets/                   # Brand icons and tray assets
├── test/setup.ts             # Vitest global setup
├── main.tsx / App.tsx        # Entry point and root component
├── ScreenshotOverlay.tsx     # Full-screen OCR overlay
└── types.ts                  # Shared wire interfaces

src-tauri/src/
├── main.rs                   # Windows entry point (windows_subsystem)
├── lib.rs                    # Module wiring, run() builder, generate_handler! registration
├── app_state.rs              # AppState, tray menu-item newtypes and StartupWarnings
├── ball_position.rs          # Island geometry constants, clamping and position tests
├── ball_emit.rs              # Readiness-gated emits to the ball webview (BALL_EMIT_LOCK)
├── tray_actions.rs           # Tray menu callbacks (toggle main/pin/shortcuts/clipboard watch)
├── commands/                 # Tauri commands + helper modules; translate.rs owns TM/history commits
├── config/                   # Settings, credentials, persistence and request scopes
├── error.rs                  # CommandError { code, message } and stable error codes
├── translate.rs              # Provider routing and scoped cancellation facade
├── translate/                # Requests, completion, SSE, Google provider and language helpers
├── tm/                       # Translation memory (SQLite); store/query/csv_io + tm_csv row encoding
├── history.rs                # Translation history
├── ocr/                      # Screenshot session buffer, image preparation and Windows OCR
├── window_regions.rs         # Smart-region hit testing for screenshots
├── clipboard.rs              # Clipboard read/write backend
├── keyboard/                 # Copy/paste simulation, selection capture, replace-target identity
├── selection.rs              # Selection identity for Alt+R auto-replace
├── cursor.rs                 # Cursor position and edge detection for window placement
├── persistence.rs            # Lossless JSON store recovery
├── lock.rs                   # Poison-recovering mutex helpers
├── logging.rs                # Rotating file logging
└── setup/                    # Shortcuts, tray and clipboard watcher
```

Tests are colocated: `*.test.ts(x)` next to sources, `__tests__/` under
`hooks/` and `components/`, and `*_tests.rs` modules inside `src-tauri/src`.

Read [the current architecture](docs/architecture/ARCHITECTURE.md) for ownership,
entry points and concurrency invariants. Refactoring reports describe historical snapshots.

## Tauri Commands (58 total)
<!-- BEGIN TAURI_COMMANDS -->
**Config**: `frontend_ready`, `get_startup_warnings`, `get_api_config`, `set_api_config`, `get_logging_enabled`, `set_logging_enabled`, `log_frontend_message`, `set_hotkeys`, `set_shortcuts_suspended`, `set_glossary`, `set_free_translation`, `set_max_records`

**Clipboard**: `read_clipboard_safe`, `write_clipboard_safe`, `cleanup_clipboard_text`

**Profile**: `list_service_profiles`, `save_service_profile`, `delete_service_profile`, `apply_service_profile`, `test_connection`

**Translation**: `translate_with_direction`, `translate_stream`, `cancel_translation`, `translate_batch`

**History**: `get_history`, `delete_history_record`, `clear_history`

**TM**: `tm_search`, `tm_delete`, `tm_clear`, `tm_stats`, `tm_export`, `tm_import`, `tm_import_content`, `get_tm_dir`, `set_tm_dir`

**Window**: `hide_window`, `toggle_pin`, `get_pin_state`, `set_ball_window_bounds`, `start_window_drag`, `show_main_window`, `hide_quick_window`, `show_main_with_text`, `quick_frontend_ready`, `reserve_quick_request`, `reveal_quick_result`

**Ball**: `translate_clipboard_from_ball`, `start_screenshot_from_ball`, `toggle_ball_show_main`, `toggle_ball`, `save_ball_position`, `get_ball_position`, `get_foreground_window_info`

**OCR**: `get_screenshot_payload`, `cancel_screenshot`, `run_ocr_on_crop`, `finish_ocr`
<!-- END TAURI_COMMANDS -->

`pnpm check:commands` enforces parity across four surfaces: `generate_handler!`
in `lib.rs`, this list, the `CommandName` union, and every `invokeCommand`
wrapper in `tauriBridge.ts`. Update all four when adding or removing a command.

## Hard Constraints
1. **NO direct `invoke()` outside the bridge** → All IPC via `src/services/tauriBridge.ts` (tests may mock `@tauri-apps/api/core`).
2. **Module size budget**: ≤200 lines per file in the enforced scope — `src/features/ball/`, `src-tauri/src/config/`, `src-tauri/src/translate/`, plus the files listed in `scripts/check-architecture.mjs`. Oversized legacy modules (`lib.rs`, larger files under `setup/shortcuts/` and `tm/`, …) are documented debt: prefer extracting logic over growing them further.
3. **Strict TypeScript**: NO `any` types in production code (ESLint `no-explicit-any` = error, fails `pnpm check`).
4. **Rust errors**: Fallible Tauri commands return `Result<T, CommandError>` with stable `code` and `message` fields (`src-tauri/src/error.rs`); infallible commands may return plain values.
5. **Naming conflicts**: Import bridge functions `as XxxCmd` when local functions have same name.

## State Ownership

- Main and quick windows each own a `useTranslationSession`; text and file operations share that window's session.
- Async operations must commit through the session with their request ID. Do not add independent loading/error/result state to operation hooks.
- Request completion is idempotent: IPC return and stream-done can arrive in either order. Cancellation/reset invalidates late results immediately.
- Island native geometry changes go through `IslandTransitionCoordinator`; dragging pauses its queue. Business events request transitions rather than resizing windows directly.
- Backend configuration lives in `config/`; `translate.rs` re-exports existing entry points for compatibility. Provider modules must not write history or TM.

## Wire Format
- Rust `base_url` (snake_case) → TS `baseUrl` (camelCase) at bridge boundary
- TmEntry/TmStats keep snake_case fields matching Rust output
- TM CSV exports now write `vanishtrans-csv-v2` rows (extra `context_hash`, `created_at`, `hit_count` columns); the importer keeps `vanishtrans-csv-v1` files and unmarked files working literally — v1/unmarked rows import under the current context with file-order upserts, v2 rows restore their own context and only overwrite same-key rows when not older.
- TM imports commit per 500 rows so `tm.conn` is released between chunks; a mid-file failure is a partial import and the error message says how many rows were already committed.
- `set_tm_dir` repoints the live `TranslationMemory` connection after the config is saved, so a successful directory change takes effect without restart.
- Failing commands throw `CommandError { code, message }`; the bridge normalizes non-conforming errors to `{ code: "UNKNOWN" }`

## Dev Commands
```bash
pnpm install              # Install deps
pnpm check               # Architecture/command checks, TS, tests, ESLint
pnpm check:rust          # cargo fmt --check + clippy -D warnings + cargo test
pnpm tsc --noEmit         # TS check
pnpm test                 # Frontend tests (Vitest)
pnpm lint                 # ESLint only
pnpm ladle                # Component/UI lab at http://127.0.0.1:6106
pnpm ladle:build          # Validate/build Ladle stories into .ladle-build/
pnpm tauri dev            # Dev mode
```

## Maintenance Workflow

- This project is close to complete and is maintained mainly through daily use and bug reports.
- When the user reports a bug, inspect the current implementation, diagnose it, make the smallest necessary fix, and run proportionate verification.
- Do not expand scope, add unrelated features, perform broad refactors, or upgrade dependencies without a clear request.
- Keep the final explanation concise: cause, changes, and verification result.
