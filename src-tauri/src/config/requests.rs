//! Sequence checks and commits share one lock; window labels isolate cancellation.
use super::ApiConfig;
use crate::lock::LockRecover;
use std::sync::atomic::Ordering;

impl ApiConfig {
    /// Claim a request sequence within one webview scope.
    pub fn next_request_seq(&self, scope: &str) -> u64 {
        let mut sequences = self.request_seq.lock_recover();
        let sequence = sequences.entry(scope.to_string()).or_insert(0);
        *sequence += 1;
        *sequence
    }

    /// Invalidate only the current request in one webview scope.
    pub fn cancel_current_request(&self, scope: &str) {
        self.next_request_seq(scope);
    }

    /// Returns true if `seq` is still the latest request in `scope`.
    pub fn is_current_request(&self, scope: &str, seq: u64) -> bool {
        self.request_seq.lock_recover().get(scope).copied() == Some(seq)
    }

    /// Run a side effect only while this request is still current.
    /// Sequence claims wait for the same lock, so the check and commit are atomic.
    pub(crate) fn with_current_request<T>(
        &self,
        scope: &str,
        seq: u64,
        commit: impl FnOnce() -> T,
    ) -> Option<T> {
        let sequences = self.request_seq.lock_recover();
        if sequences.get(scope).copied() != Some(seq) {
            return None;
        }
        Some(commit())
    }

    /// Claim a new Alt+R replacement sequence number.
    pub fn next_replace_request_seq(&self) -> u64 {
        self.replace_request_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Returns true if `seq` is still the latest Alt+R replacement request.
    pub fn is_current_replace_request(&self, seq: u64) -> bool {
        self.replace_request_seq.load(Ordering::SeqCst) == seq
    }
}
