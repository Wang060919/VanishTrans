//! Poison-recovering mutex helpers.
//!
//! `std::sync::Mutex` becomes poisoned when a thread panics while holding the
//! guard. For in-process state (config, caches, clipboards) the guarded data is
//! still consistent, so we recover from the poison instead of panicking — a
//! single panicking worker should never take the whole app down.

use std::sync::{Mutex, MutexGuard};

/// Extension trait that locks a mutex and recovers from poisoning.
pub trait LockRecover {
    type Item;
    fn lock_recover(&self) -> MutexGuard<'_, Self::Item>;
}

impl<T> LockRecover for Mutex<T> {
    type Item = T;
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poison| poison.into_inner())
    }
}
