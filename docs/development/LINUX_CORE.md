# Linux edition (experimental)

The port uses a normal resizable window and the existing translation session,
history, glossary and SQLite translation-memory backends. Native Arch + KDE Plasma
Wayland acceptance is still required; successful CI is not desktop verification.

## Core and optional integrations

- Manual entry/paste, streaming translation/cancellation, output copy, history,
  service profiles, glossary and translation memory.
- Best-effort Open/Quit tray. Closing the main window exits; the taskbar, tray and
  second launch can reopen a minimized window.
- API keys use the system Secret Service persistent collection. Install and unlock
  a compatible provider, such as GNOME Keyring or KWallet with Secret Service enabled.
  Unavailable/locked services produce explicit warnings or save errors; there is no
  plaintext fallback. Config files and service profiles never contain the key.
- Settings → Hotkeys → Authorize opens the desktop GlobalShortcuts portal. Only
  Open Window and Screenshot OCR are requested. The system chooses the actual keys.
  No permission prompt at startup. Disable closes the session; reauthorize to change
  bindings. Sessions are per app run; the desktop may remember approved bindings.
- Screenshot opens the interactive Screenshot portal, then runs the installed
  `tesseract` executable locally. Install the engine and selected language packages
  (for example `eng`, `chi_sim`, `chi_tra`); use `chi_sim+eng` for combined recognition.
  The result is an editable draft. Applying explicitly replaces input; translation
  still requires a separate user action. Screenshots are never sent to an API.

Portals require `xdg-desktop-portal` and a compatible backend, typically
`xdg-desktop-portal-kde` on Plasma. Missing services, rejected consent, missing OCR
engine/languages and failed recognition surface errors without preventing startup.
These runtime tools are not bundled or installed by VanishTrans.

Selection capture, synthetic paste/in-place replacement, clipboard watching, pinning
and island animations remain unavailable. The shell retains the internal `ball`
label for IPC/session identity, but bypasses Windows island positioning. Compositor
focus policies still apply: a global shortcut may show the window without focus.

## Safety limits and known limitations

OCR accepts only a local file URI returned by the screenshot portal. It reads at
most 32 MiB + 1 byte, rejects excess input, permits PNG/JPEG with at most 24 million
pixels, and passes the validated bytes through stdin using direct process arguments
(no shell). OCR has a 45-second timeout and 1 MiB output limit; duplicate captures
are rejected. No temporary image copy is written and portal-owned files are never
deleted. The desktop portal owns screenshot-file retention.

Portal consent waits at most 120 seconds. With the pinned ashpd API, a pending
Screenshot request handle is not exposed until its response, so timeout drops the
response listener but may leave the system dialog visible. Close that dialog before
retrying. A late response is not applied. Key-storage unlock prompts are bounded;
startup does not request unlock. No actual secrets are used by automated tests.

Linux automatic updates remain disabled because the upstream feed is not a Linux
port release channel. Install future builds manually.

## Build and distribution

Use Node 22, pnpm 10.33.2 and Rust 1.95.0. Follow the official
[Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).
The pinned xcap dependency still compiles: also provide clang, libxcb, libxrandr,
D-Bus, Wayland and EGL development libraries. Secret Service needs libdbus at build
and runtime. Optional portal/Tesseract components are runtime dependencies for their
features, not requirements for manual translation.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check:rust
pnpm tauri dev
# On Arch, build a native executable rather than installing a Debian package:
pnpm tauri build --no-bundle
./src-tauri/target/release/vanish-trans
```

Tauri automatically merges `src-tauri/tauri.linux.conf.json` on Linux. Windows NSIS
configuration is unchanged. Ubuntu 24.04 CI builds a `.deb` and raw executable.
The `.deb` is not an Arch package, and the raw binary is dynamically linked, not
portable/static. A native Arch build is recommended until desktop acceptance.

## Required native acceptance

Use disposable data and record Plasma, portal backend, WebKit, GPU and scale versions.

1. Launch without a tray host; close/relaunch and minimize/relaunch, single instance.
2. Chinese/English IME, copy/paste between native Wayland applications; core streaming,
   cancellation, history/TM/glossary and file flows. Never put keys into fixtures.
3. Secret Service available, absent, locked, unlock refused, save/restart, delete,
   failed save preserving the prior key; verify no key in JSON/logs/profiles.
4. Explicit shortcut authorize/cancel/deny, duplicate clicks, disable/re-enable,
   remount settings, desktop revocation, portal restart and app restart. Verify no
   remaining shortcut after disable/exit, and no selection/input injection.
5. Screenshot select/cancel/timeout; no engine, missing languages, empty/oversized
   image and OCR failure. Edit/discard draft, capture again, and apply during ordinary
   translation use. Confirm no provider request occurs before explicit Translate.
6. Multimonitor/fractional scaling, resize/maximize/minimize/focus; keyboard bindings
   configured by KDE, not the Windows shortcut plugin.
7. Upstream updater remains inactive. Run Windows native smoke checks before merge.

Official API references: [GlobalShortcuts](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html),
[Screenshot](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html).
