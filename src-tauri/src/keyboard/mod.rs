//! Keyboard simulation for copy/paste and selection capture.
//!
//! Selection capture uses three progressively more invasive strategies:
//! UI Automation, `WM_COPY` on the focused control, then `SendInput(Ctrl+C)`.
//!
//! - [`platform`] holds window identity, COM apartment lifetime and
//!   foreground-window inspection shared by the other submodules.
//! - [`input`] simulates key presses for copy/paste fallbacks.
//! - [`capture`] reads the selected text through the three strategies.
//! - [`target`] snapshots and re-verifies the replace target.

pub(crate) mod capture;
pub(crate) mod input;
pub(crate) mod platform;
pub(crate) mod target;

pub use capture::copy_selection;
pub use input::simulate_paste;
pub use platform::{
    clipboard_sequence_number, foreground_is_terminal, foreground_window_is_current,
    foreground_window_token, hold_com_apartment, ComApartment, ForegroundWindowToken,
    TextRangeIdentity,
};
pub use target::{capture_selection_target, target_is_unchanged};
