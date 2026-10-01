//! Tauri IPC commands, split by domain.
//!
//! All commands are re-exported here so callers keep using
//! `crate::commands::command_name` regardless of which submodule owns it.

mod app;
#[cfg(target_os = "windows")]
pub(crate) mod ball_region;
mod clipboard;
mod config;
mod history;
#[cfg(target_os = "windows")]
pub(crate) mod island_frame;
#[cfg(target_os = "windows")]
pub(crate) mod quick_frame;
mod quick_result;
mod screenshot;
mod screenshot_visibility;
mod tm;
mod translate;
mod window;
#[cfg(target_os = "windows")]
mod window_bounds;
mod window_drag;

pub use app::*;
pub use clipboard::*;
pub use config::*;
pub use history::*;
pub(crate) use quick_result::claim_quick_request;
pub use quick_result::*;
pub use screenshot::*;
pub use tm::*;
pub use translate::*;
pub use window::*;
pub use window_drag::*;
