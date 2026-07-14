mod clipboard_watch;
mod shortcuts;
mod tray;

pub use clipboard_watch::setup_clipboard_watch;
pub use shortcuts::{setup_shortcuts, sync_shortcuts};
pub use tray::setup_tray;
