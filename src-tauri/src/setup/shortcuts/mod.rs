use std::sync::Mutex;

mod alt_flows;
mod registry;
mod replace_flow;
mod screenshot;
#[cfg(test)]
mod tests;

/// Serializes the clipboard-critical sections of the Alt+Q and Alt+R flows.
/// Both read, overwrite and restore the physical clipboard; without mutual
/// exclusion a restore from one flow can land between the other's write and
/// its injected paste, making the target paste stale content while still
/// reporting success.
static CLIPBOARD_OP_LOCK: Mutex<()> = Mutex::new(());

pub use registry::{setup_shortcuts, sync_shortcuts};
pub(crate) use screenshot::{screenshot_window_closed, start_screenshot};
