use serde::Serialize;
use tauri::Emitter;

use crate::error::{code, CommandError};
use crate::history::HistoryStore;
use crate::translate::{do_translate_async, ApiConfig};
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
    let result = do_translate_async(&state, &text, &source_lang, &target_lang)
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

    let result = do_translate_async(&state, &text, "auto", target)
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

/// Batch translate multiple text segments in a single API call.
/// Used for file translation (.srt subtitles, .json values).
/// Each segment is separated by a unique marker so they can be split back.
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

    // Join segments with a unique marker
    const MARKER: &str = "\n\n===SEGMENT_BREAK===\n\n";
    let combined = segments.join(MARKER);
    let target = crate::translate::resolve_target_lang(&combined, &direction);
    let result = crate::translate::do_translate_async(&state, &combined, "auto", target)
        .await
        .map_err(CommandError::api)?;

    if !state.is_current_request(seq) {
        return Err(CommandError::cancelled());
    }

    // Split result back into segments
    let translated: Vec<String> = result
        .split("===SEGMENT_BREAK===")
        .map(|s| s.trim().to_string())
        .collect();

    // If split count doesn't match (model may have merged/split segments),
    // return an error so the frontend shows raw text instead of broken reassembly
    if translated.len() != segments.len() {
        return Err(CommandError::new(
            code::SEGMENT_COUNT_MISMATCH,
            "分段数量与原文不一致",
        ));
    }

    Ok(translated)
}
