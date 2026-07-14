# VanishTrans — Vanishing Signal Redesign

**Date:** 2026-07-14
**Status:** Approved for implementation

## Product constraints

- Preserve the compact 420 × 520 desktop popup form.
- Preserve current Tauri translation, OCR, file translation, history, glossary, hotkey, pin and auto-hide behavior.
- Rework the frontend at medium-high intensity and introduce a coherent brand system.
- Keep runtime and bundle cost low; React Bits is a motion reference, not a dependency dump.

## Brand direction

The selected direction is **Vanishing Signal**: a split V-shaped signal mark whose outgoing edge dissolves after language conversion. The visual system uses warm neutral light surfaces, graphite dark surfaces and a restrained Signal Blue accent. The brand avoids globe, speech bubble, flag and generic translation-arrow clichés.

## Main window

Use a frameless Tauri window with an accessible custom drag header. The header contains the Vanish Mark and wordmark, then pin, history, settings and close actions. The language direction becomes a compact two-sided control. Input and output form one continuous vertical translation workspace separated by a branded signal divider rather than two floating cards.

The input area exposes clear, paste and an explicit Enter-to-translate control. The output area exposes copy with a deterministic success state. Streaming text remains readable and is not replayed through a second typewriter animation.

## Overlays

History and settings become mutually exclusive full-height overlay drawers instead of being inserted into the flex layout. History provides search, grouped records and focus-visible actions. Settings uses API, shortcuts and glossary tabs with an independently scrollable body.

## Visual tokens

- System UI typography, 14px translation text, no routine 10px copy.
- Spacing scale: 4, 6, 8, 12, 16, 20, 24.
- Radius scale: 6, 8, 10, 12.
- Low-contrast borders; shadows only for window, drawers and popovers.
- Theme modes: system, light and dark, persisted locally.
- Signal Blue is reserved for focus, active actions and transient status.

## Motion

Motion uses CSS transitions and keyframes only. Standard durations are 100, 160, 220 and 360ms with transform/opacity animation. Reduced-motion users receive opacity-only or immediate state changes.

React Bits-inspired replacements:

- Replace repeated shiny text with a one-shot BrandReveal.
- Replace ClickSpark DOM injection with a fixed SignalBurst success effect.
- Replace GlowBorder with a compact SignalDivider/status line.
- Replace timer-heavy list animation with a bounded StaggerList.
- Remove Typewriter from completed translation output.

## Accessibility

All icon-only controls have accessible names. Toggle buttons expose pressed state. Drawers support Escape, focus visibility and correct dialog semantics. Hover-only history actions also appear on focus-within. Status messages use appropriate live regions. Motion respects `prefers-reduced-motion`.

## Assets

Deliver a reusable SVG Vanish Mark, primary app icon source, generated Tauri icon set and a monochrome-capable tray mark. Native tray menu labels do not use emoji.

## Non-goals

- No backend translation protocol changes.
- No new translation languages beyond the existing direction enum.
- No GSAP, Framer Motion, React Spring or full UI framework.
- No landing page or large-window application mode.
