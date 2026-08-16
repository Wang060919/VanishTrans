use serde::Serialize;
use tauri::Emitter;

use crate::error::{code, CommandError};
use crate::history::HistoryStore;
use crate::translate::{do_free_translate_async, do_translate_unified, ApiConfig};
use serde::Deserialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamChunkEvent {
    request_id: u64,
    chunk: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDoneEvent {
    request_id: u64,
    full_text: String,
}

/// Arguments for `translate_stream`, grouped so the command stays small.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateStreamRequest {
    pub text: String,
    pub direction: String,
    pub request_id: u64,
    #[serde(default)]
    pub force_refresh: Option<bool>,
}

// -----------------------------------------------------------
// Translation commands
// -----------------------------------------------------------

/// Cancel the current main-window translation. The active request observes
/// the sequence change and returns the structured `CANCELLED` error.
#[tauri::command]
pub fn cancel_translation(state: tauri::State<'_, ApiConfig>) {
    state.cancel_current_request();
}

#[tauri::command]
pub async fn translate(
    state: tauri::State<'_, ApiConfig>,
    text: String,
    source_lang: String,
    target_lang: String,
) -> Result<String, CommandError> {
    let seq = state.next_request_seq();
    let result = do_translate_unified(&state, &text, &source_lang, &target_lang)
        .await
        .map_err(CommandError::api)?;
    if !state.is_current_request(seq) {
        // A newer request superseded this one — silently drop the result
        return Err(CommandError::cancelled());
    }
    Ok(result)
}

#[tauri::command]
pub async fn translate_with_direction(
    state: tauri::State<'_, ApiConfig>,
    history: tauri::State<'_, HistoryStore>,
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    text: String,
    direction: String,
    force_refresh: Option<bool>,
) -> Result<String, CommandError> {
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let seq = state.next_request_seq();
    let context_hash = state.translation_context_hash();

    // Check Translation Memory first
    if force_refresh != Some(true) {
        if let Some(cached) = tm.lookup_in_context(&text, "auto", target, &context_hash) {
            if !state.is_current_request(seq) {
                return Err(CommandError::cancelled());
            }
            history.add(&text, &cached, &direction);
            return Ok(cached);
        }
    }

    let result = do_translate_unified(&state, &text, "auto", target)
        .await
        .map_err(CommandError::api)?;
    if !state.is_current_request(seq) {
        return Err(CommandError::cancelled());
    }
    // Store in TM and history
    tm.store_in_context(&text, &result, "auto", target, &context_hash);
    history.add(&text, &result, &direction);
    Ok(result)
}

#[tauri::command]
pub async fn translate_stream(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ApiConfig>,
    history: tauri::State<'_, HistoryStore>,
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    request: TranslateStreamRequest,
) -> Result<String, CommandError> {
    let TranslateStreamRequest {
        text,
        direction,
        request_id,
        force_refresh,
    } = request;
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let seq = state.next_request_seq();
    let context_hash = state.translation_context_hash();

    // Check Translation Memory first
    if force_refresh != Some(true) {
        if let Some(cached) = tm.lookup_in_context(&text, "auto", target, &context_hash) {
            if !state.is_current_request(seq) {
                return Err(CommandError::cancelled());
            }
            let _ = window.emit(
                "translate-stream-chunk",
                StreamChunkEvent {
                    request_id,
                    chunk: cached.clone(),
                },
            );
            let _ = window.emit(
                "translate-stream-done",
                StreamDoneEvent {
                    request_id,
                    full_text: cached.clone(),
                },
            );
            history.add(&text, &cached, &direction);
            return Ok(cached);
        }
    }

    // Free Google provider has no streaming endpoint — resolve the full result
    // and emit it as a single chunk so the frontend streaming flow stays intact.
    if state.free_translation() {
        let result = do_free_translate_async(&state, &text, target)
            .await
            .map_err(CommandError::api)?;
        if !state.is_current_request(seq) {
            return Err(CommandError::cancelled());
        }
        let _ = window.emit(
            "translate-stream-chunk",
            StreamChunkEvent {
                request_id,
                chunk: result.clone(),
            },
        );
        let _ = window.emit(
            "translate-stream-done",
            StreamDoneEvent {
                request_id,
                full_text: result.clone(),
            },
        );
        tm.store_in_context(&text, &result, "auto", target, &context_hash);
        history.add(&text, &result, &direction);
        return Ok(result);
    }

    let window_clone = window.clone();
    let seq_for_closure = seq;
    let state_for_closure = state.inner();
    let result = crate::translate::do_translate_stream_async(
        state_for_closure,
        &text,
        "auto",
        target,
        seq,
        |chunk| {
            // Check cancellation before emitting each chunk
            if !state_for_closure.is_current_request(seq_for_closure) {
                return;
            }
            let _ = window_clone.emit(
                "translate-stream-chunk",
                StreamChunkEvent { request_id, chunk },
            );
        },
    )
    .await
    .map_err(CommandError::api)?;

    if !state.is_current_request(seq) {
        return Err(CommandError::cancelled());
    }

    let _ = window.emit(
        "translate-stream-done",
        StreamDoneEvent {
            request_id,
            full_text: result.clone(),
        },
    );
    // Store in TM and history
    tm.store_in_context(&text, &result, "auto", target, &context_hash);
    history.add(&text, &result, &direction);
    Ok(result)
}

/// Marker separating segments in a batched translation request.
const SEGMENT_MARKER: &str = "\n\n===SEGMENT_BREAK===\n\n";

/// Marker used to split the model's batched response back into segments.
const SEGMENT_SPLIT_MARKER: &str = "===SEGMENT_BREAK===";

/// Join segments into one request payload, separated by an unambiguous marker.
fn join_segments(segments: &[String]) -> String {
    segments.join(SEGMENT_MARKER)
}

/// Split a batched translation result back into segments, trimming surrounding
/// whitespace the model may have introduced. Returns `SEGMENT_COUNT_MISMATCH`
/// when the model merged or dropped segments, so the caller can fall back to
/// showing raw text instead of a broken reassembly.
fn split_translated(result: &str, expected_len: usize) -> Result<Vec<String>, CommandError> {
    let translated: Vec<String> = result
        .split(SEGMENT_SPLIT_MARKER)
        .map(|segment| segment.trim().to_string())
        .collect();
    if translated.len() != expected_len {
        return Err(CommandError::new(
            code::SEGMENT_COUNT_MISMATCH,
            "分段数量与原文不一致",
        ));
    }
    Ok(translated)
}

/// Batch translate multiple text segments in a single API call.
/// Used for file translation (.srt subtitles, .json values).
///
/// This path intentionally bypasses the translation-memory cache and does not
/// write to it: the combined multi-segment request is a different key space
/// from per-segment lookups, and caching a partial reassembly would risk
/// returning a stale or mismatched block layout. Single-shot translation
/// (`translate_with_direction` / `translate_stream`) remains the cache-backed path.
#[tauri::command]
pub async fn translate_batch(
    state: tauri::State<'_, ApiConfig>,
    segments: Vec<String>,
    direction: String,
) -> Result<Vec<String>, CommandError> {
    if segments.is_empty() {
        return Ok(Vec::new());
    }

    let seq = state.next_request_seq();

    let combined = join_segments(&segments);
    let target = crate::translate::resolve_target_lang(&combined, &direction);

    // The free Google provider does not understand the segment-break marker, so
    // translate each segment individually instead of sending one batched prompt.
    if state.free_translation() {
        let mut translated = Vec::with_capacity(segments.len());
        for segment in &segments {
            let text = do_free_translate_async(&state, segment, target)
                .await
                .map_err(CommandError::api)?;
            if !state.is_current_request(seq) {
                return Err(CommandError::cancelled());
            }
            translated.push(text);
        }
        return Ok(translated);
    }

    let result = crate::translate::do_translate_async(&state, &combined, "auto", target)
        .await
        .map_err(CommandError::api)?;

    if !state.is_current_request(seq) {
        return Err(CommandError::cancelled());
    }

    split_translated(&result, segments.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_segments_separates_each_segment_with_the_marker() {
        assert_eq!(
            join_segments(&["a".to_string(), "b".to_string()]),
            "a\n\n===SEGMENT_BREAK===\n\nb"
        );
    }

    #[test]
    fn split_translated_trims_surrounding_whitespace() {
        let translated = split_translated(" 你好 \n\n===SEGMENT_BREAK===\n\n world ", 2).unwrap();
        assert_eq!(translated, vec!["你好".to_string(), "world".to_string()]);
    }

    #[test]
    fn split_translated_handles_a_single_segment() {
        let translated = split_translated("hello", 1).unwrap();
        assert_eq!(translated, vec!["hello".to_string()]);
    }

    #[test]
    fn split_translated_reports_a_segment_count_mismatch() {
        let error = split_translated("only one segment", 2).unwrap_err();
        assert_eq!(error.code, code::SEGMENT_COUNT_MISMATCH);
    }
}
