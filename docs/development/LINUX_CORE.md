# Linux core edition (experimental)

The Linux port reuses the existing translation sessions and Rust translation, history,
glossary and SQLite translation-memory backends. It opens a normal resizable window;
it does not require XWayland for island positioning. Native KDE Wayland acceptance is
still required before calling this an Arch-ready release.

## Supported scope

- Manual text entry and normal paste, translation and streaming/cancellation.
- Copy output, history, service profiles, glossary and translation memory.
- A best-effort tray menu with Open and Quit. A missing tray does not abort startup.
- Minimize and reopen from the taskbar, tray or second launch. Closing the main
  window exits; it never leaves an invisible process that requires a working tray.

Global hotkeys, selection capture, in-place replacement, clipboard watching,
screenshot/OCR and island animations are deliberately unavailable. The Linux
configuration keeps the internal `ball` label to preserve IPC and stream ownership,
but renders `MainWindowApp` directly. It never restores Windows-style global
coordinates or starts the global-shortcut plugin. This is not a Wayland input
permission workaround.

## Credentials and updates

The API key exists only in process memory for the current run. The settings page
and startup notice say this explicitly. Exiting clears it; the next run requires
re-entry. Normal configuration, profiles, history and translation memory still
persist. No plaintext key storage or Secret Service integration is added.

Linux automatic updates are disabled: the upstream release feed is not a release
channel for this experimental port. Install future builds manually.

## Build on Arch KDE Wayland

Use Node 22, pnpm 10.33.2 and the repository's Rust 1.95.0 toolchain. Follow the
[Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux) for
current distribution package names. In addition to Tauri's GTK/WebKit/OpenSSL and
tray development libraries, the currently pinned xcap dependency still compiles
its Linux backend even though OCR is disabled; have clang, libxcb, libxrandr,
dbus, Wayland and EGL development libraries available. No dependency upgrades
are part of this port.

From the repository root after installing the prerequisites:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm check:rust
pnpm tauri dev
# Native executable for this machine (no Debian package on Arch):
pnpm tauri build --no-bundle
./src-tauri/target/release/vanish-trans
```

Tauri automatically merges `src-tauri/tauri.linux.conf.json` on Linux; do not pass
that configuration on Windows. The normal Windows build and NSIS targets remain
unchanged. The Linux override supplies one regular window and disables updater
artifacts.

CI's Ubuntu 24.04 job checks frontend and Rust code and builds a `.deb` plus a
raw executable artifact. The `.deb` is for Debian-family testing, **not an Arch
package**. A raw Ubuntu executable is not a portable static binary; its GTK,
WebKit, OpenSSL and other shared-library requirements still apply. Prefer a
native Arch build for this first personal-use version. AUR/PKGBUILD and AppImage
distribution can follow successful native testing.

## Acceptance checklist

Automated tests do not establish native Wayland compatibility. Run on the intended
Arch + Plasma + Wayland session, recording Plasma, WebKit, GPU and scale settings:

1. Launch without a tray host; ensure the main window remains usable. Close and
   relaunch; minimize then relaunch; verify there is only one usable instance.
2. Enter Chinese and English using the normal IME; paste from a native Wayland
   browser/editor; copy translated output back to both. Test an empty clipboard.
3. Test a known service with a user-entered key: streaming, cancel/retry, provider
   failure and rapid repeated translation. Never place a real key in test fixtures.
4. Confirm no key appears in config.json; quit/restart and verify key is empty.
   Other settings, glossary, history and TM must survive restart.
5. Verify history search/deletion, TM import/export and destination changes using
   disposable test data. Confirm output-copy and ordinary text-file flows.
6. Verify screenshots, global hotkeys and pin controls are absent or explicitly
   unsupported; the About tab must not contact the upstream update feed.
7. Test 100% and fractional scaling, multiple monitors, dragging, resize, maximize,
   minimize and focus changes. No global coordinate calls are needed for the shell.
8. Run the Windows checks and native smoke tests before merging changes shared
   with the Windows edition.

Until CI completes, Rust checks/package creation are unverified. Until the above
real-desktop checks complete, Arch KDE Wayland runtime behavior is unverified.
