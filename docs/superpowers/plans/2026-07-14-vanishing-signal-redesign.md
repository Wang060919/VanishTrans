# Vanishing Signal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild VanishTrans as a branded, accessible 420 × 520 translation workspace while preserving all existing Tauri behavior.

**Architecture:** Keep translation/config hooks and Rust commands intact. Split the UI into focused brand, workspace, navigation and overlay components; use CSS tokens and CSS-only motion; keep overlay state in `MainLayout` and theme state in a small hook.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Tauri 2, Vitest, Testing Library, lucide-react.

---

## File map

- Create `src/components/brand/VanishMark.tsx`: reusable brand mark and wordmark.
- Create `src/components/AnimatedContent.tsx`: reduced-motion aware transition wrapper.
- Create `src/components/SignalBurst.tsx`: deterministic success micro-animation.
- Create `src/components/LanguageSwitcher.tsx`: accessible direction control.
- Create `src/components/OverlayDrawer.tsx`: history/settings overlay shell.
- Create `src/hooks/useTheme.ts`: persisted system/light/dark theme.
- Modify `src/layouts/MainLayout.tsx`: custom header, mutually exclusive drawers, new workspace composition.
- Modify `src/features/TranslatePanel.tsx`: continuous editor/result workspace and explicit actions.
- Modify `src/features/HistoryPanel.tsx`: drawer content, grouping and focus-visible actions.
- Modify `src/features/SettingsPanel.tsx`: tabbed settings content and theme control.
- Modify `src/components/IconButton.tsx`: accessible icon control contract.
- Modify `src/index.css` and `tailwind.config.js`: Vanishing Signal tokens and motion.
- Modify `src-tauri/tauri.conf.json`: frameless compact window.
- Modify `src-tauri/src/setup/tray.rs`: brand-consistent native tray labels.
- Create/refresh `src/assets/brand/*` and `src-tauri/icons/*`: brand assets.
- Modify tests under `src/**/*.test.tsx`: protect new structure and existing behavior.

### Task 1: Protect the new interaction contract

- [ ] Add failing App tests for accessible header actions, explicit translate action, mutually exclusive history/settings overlays, and removal of emoji controls.
- [ ] Run `pnpm test` and confirm the new assertions fail before implementation.
- [ ] Add focused component tests for `LanguageSwitcher`, `OverlayDrawer`, and copy success behavior.

### Task 2: Build brand and foundation components

- [ ] Install `lucide-react`.
- [ ] Implement `VanishMark`, accessible `IconButton`, `AnimatedContent`, `OverlayDrawer`, `LanguageSwitcher`, and `SignalBurst`.
- [ ] Run focused component tests until green.

### Task 3: Establish the visual system

- [ ] Replace legacy CSS tokens with light/dark Vanishing Signal tokens and add `data-theme` support.
- [ ] Add typography, spacing, focus, scrollbar, reduced-motion and z-layer rules.
- [ ] Remove looping shiny, glowPulse and layout-triggering fade/max-height animations.
- [ ] Implement and test `useTheme` persistence.

### Task 4: Rebuild the compact translation workspace

- [ ] Refactor `MainLayout` into a frameless custom header, language strip, workspace and compact status footer.
- [ ] Refactor `TranslatePanel` into source/result sections with clear, paste, translate, retry and copy-success actions.
- [ ] Remove completed-result `Typewriter` and whole-panel `GlowBorder` usage.
- [ ] Preserve streaming, drag/drop, error, file status and character-limit behavior.
- [ ] Run App and component tests.

### Task 5: Rebuild overlays

- [ ] Convert history to an overlay drawer with search, grouped records, accessible actions and empty state.
- [ ] Convert settings to a tabbed overlay with API, shortcut, glossary and appearance sections.
- [ ] Ensure opening one overlay closes the other and Escape closes the active overlay.
- [ ] Add and run overlay interaction tests.

### Task 6: Apply desktop branding

- [ ] Set Tauri window `decorations` to false while retaining resize, size constraints and drag behavior.
- [ ] Create SVG brand sources and generate the Tauri icon set.
- [ ] Remove emoji from tray menu labels and retain existing menu commands.
- [ ] Run `cargo check --manifest-path src-tauri/Cargo.toml`.

### Task 7: Verification and visual audit

- [ ] Run `pnpm test` and confirm all tests pass.
- [ ] Run `pnpm build` and record bundle output.
- [ ] Run `cargo check --manifest-path src-tauri/Cargo.toml`.
- [ ] Launch the UI with mocked Tauri APIs at 420 × 520, 360 × 480 and 320 × 360.
- [ ] Capture light/dark screenshots and verify no clipping, inaccessible hover-only controls or uncontrolled animation.
- [ ] Review `git diff --check` and `git status --short` before reporting completion.
