//! Translation facade: provider routing and scoped cancellation.
//! Commands own TM/history commits; provider modules only return translated text.
mod completion;
mod google;
mod http;
mod language;
mod request;
mod sse;
mod streaming;

pub use crate::config::{ApiConfig, ServiceProfile, CONFIG_FILE_LOCK};
use completion::do_translate_async;
pub use completion::test_connection_async;
use google::do_free_translate_async;
pub use language::resolve_target_lang;
use std::time::Duration;
pub use streaming::do_translate_stream_async;

/// Shared cancellation signal for streaming and non-streaming transports.
async fn wait_for_request_superseded(state: &ApiConfig, scope: &str, seq: u64) {
    while state.is_current_request(scope, seq) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Route to the free provider or configured API without writing history or TM.
pub async fn do_translate_unified(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    if state.free_translation() {
        do_free_translate_async(state, text, target_lang).await
    } else {
        do_translate_async(state, text, source_lang, target_lang).await
    }
}

/// Unified translation that can be cancelled by a request in the same scope.
pub async fn do_translate_unified_scoped(
    state: &ApiConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    scope: &str,
    seq: u64,
) -> Result<String, String> {
    tokio::select! {
        result = do_translate_unified(state, text, source_lang, target_lang) => result,
        _ = wait_for_request_superseded(state, scope, seq) => Err("CANCELLED".into()),
    }
}

#[cfg(test)]
mod sse_tests;

#[cfg(test)]
mod google_tests;

#[cfg(test)]
mod language_tests;
