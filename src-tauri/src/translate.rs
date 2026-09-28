//! Translation facade: provider routing and scoped cancellation.
//! Commands own TM/history commits; provider modules only return translated text.
mod completion;
mod google;
mod http;
mod language;
mod request;
mod sse;
mod streaming;

pub use crate::config::{ApiConfig, ServiceProfile};
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
    let snapshot = state.translation_snapshot();
    translate_with_snapshot(state, &snapshot, text, source_lang, target_lang).await
}

async fn translate_with_snapshot(
    state: &ApiConfig,
    snapshot: &crate::config::TranslationConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    if snapshot.free_translation {
        do_free_translate_async(state, text, target_lang).await
    } else {
        do_translate_async(state, snapshot, text, source_lang, target_lang).await
    }
}

/// Unified translation with one configuration snapshot and scoped cancellation.
pub async fn do_translate_unified_scoped(
    state: &ApiConfig,
    snapshot: &crate::config::TranslationConfig,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    scope: &str,
    seq: u64,
) -> Result<String, String> {
    tokio::select! {
        result = translate_with_snapshot(state, snapshot, text, source_lang, target_lang) => result,
        _ = wait_for_request_superseded(state, scope, seq) => Err("CANCELLED".into()),
    }
}

#[cfg(test)]
mod sse_tests;

#[cfg(test)]
mod google_tests;

#[cfg(test)]
mod language_tests;

#[cfg(test)]
mod completion_tests;

#[cfg(test)]
mod snapshot_tests;
