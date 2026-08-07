//! Tauri IPC commands, split by domain.
//!
//! All commands are re-exported here so callers keep using
//! `crate::commands::command_name` regardless of which submodule owns it.

mod app;
mod clipboard;
mod config;
mod history;
mod screenshot;
mod tm;
mod translate;
mod window;

pub use app::*;
pub use clipboard::*;
pub use config::*;
pub use history::*;
pub use screenshot::*;
pub use tm::*;
pub use translate::*;
pub use window::*;
