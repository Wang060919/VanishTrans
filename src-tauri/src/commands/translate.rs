use serde::Serialize;
use tauri::Emitter;

use crate::error::{code, CommandError};
use crate::history::HistoryStore;
use crate::translate::{do_translate_unified_scoped, ApiConfig};
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

/// Per-segment batch progress for the free provider path. The paid path is a
/// single request, so only the per-segment loop emits this.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileProgressEvent {
    completed: usize,
    total: usize,
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

fn map_translation_error(error: String) -> CommandError {
    if error == "CANCELLED" {
        CommandError::cancelled()
    } else {
        CommandError::api(error)
    }
}

/// A TM write failure must not discard a successful translation or hide it
/// behind an IO error — the cache degrades, the user keeps the result.
pub(crate) fn persist_translation(
    tm: &crate::tm::TranslationMemory,
    history: &HistoryStore,
    source: &str,
    target: &str,
    direction: &str,
    target_lang: &str,
    context_hash: &str,
) {
    if let Err(error) = tm.store_in_context(source, target, "auto", target_lang, context_hash) {
        log::warn!("[translate] TM write failed; result still returned: {error}");
    }
    history.add(source, target, direction);
}
// -----------------------------------------------------------
// Translation commands
// -----------------------------------------------------------

/// Cancel the current main-window translation. The active request observes
/// the sequence change and returns the structured `CANCELLED` error.
#[tauri::command]
pub fn cancel_translation(window: tauri::WebviewWindow, state: tauri::State<'_, ApiConfig>) {
    state.cancel_current_request(window.label());
}

#[tauri::command]
pub async fn translate_with_direction(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ApiConfig>,
    history: tauri::State<'_, HistoryStore>,
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    text: String,
    direction: String,
    force_refresh: Option<bool>,
) -> Result<String, CommandError> {
    let target = crate::translate::resolve_target_lang(&text, &direction);
    let scope = window.label();
    let seq = state.next_request_seq(scope);
    let snapshot = state.translation_snapshot();
    let context_hash = snapshot.context_hash();

    // Check Translation Memory first
    if force_refresh != Some(true) {
        if let Some(cached) = tm.lookup_in_context(&text, "auto", target, &context_hash) {
            if state
                .with_current_request(scope, seq, || history.add(&text, &cached, &direction))
                .is_none()
            {
                return Err(CommandError::cancelled());
            }
            return Ok(cached);
        }
    }

    let result = do_translate_unified_scoped(&state, &snapshot, &text, "auto", target, scope, seq)
        .await
        .map_err(map_translation_error)?;
    if state
        .with_current_request(scope, seq, || {
            persist_translation(
                &tm,
                &history,
                &text,
                &result,
                &direction,
                target,
                &context_hash,
            )
        })
        .is_none()
    {
        return Err(CommandError::cancelled());
    }
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
    let scope = window.label();
    let seq = state.next_request_seq(scope);
    let snapshot = state.translation_snapshot();
    let context_hash = snapshot.context_hash();

    // Check Translation Memory first
    if force_refresh != Some(true) {
        if let Some(cached) = tm.lookup_in_context(&text, "auto", target, &context_hash) {
            if state
                .with_current_request(scope, seq, || history.add(&text, &cached, &direction))
                .is_none()
            {
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
            return Ok(cached);
        }
    }

    // Free Google provider has no streaming endpoint — resolve the full result
    // and emit it as a single chunk so the frontend streaming flow stays intact.
    if snapshot.free_translation {
        let result =
            do_translate_unified_scoped(&state, &snapshot, &text, "auto", target, scope, seq)
                .await
                .map_err(map_translation_error)?;
        if state
            .with_current_request(scope, seq, || {
                persist_translation(
                    &tm,
                    &history,
                    &text,
                    &result,
                    &direction,
                    target,
                    &context_hash,
                )
            })
            .is_none()
        {
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
        return Ok(result);
    }

    let window_clone = window.clone();
    let seq_for_closure = seq;
    let state_for_closure = state.inner();
    let result = crate::translate::do_translate_stream_async(
        state_for_closure,
        &snapshot,
        &text,
        target,
        scope,
        seq,
        |chunk| {
            // Check cancellation before emitting each chunk
            if !state_for_closure.is_current_request(scope, seq_for_closure) {
                return;
            }
            let _ = window_clone.emit(
                "translate-stream-chunk",
                StreamChunkEvent { request_id, chunk },
            );
        },
    )
    .await
    .map_err(map_translation_error)?;

    if state
        .with_current_request(scope, seq, || {
            persist_translation(
                &tm,
                &history,
                &text,
                &result,
                &direction,
                target,
                &context_hash,
            )
        })
        .is_none()
    {
        return Err(CommandError::cancelled());
    }
    let _ = window.emit(
        "translate-stream-done",
        StreamDoneEvent {
            request_id,
            full_text: result.clone(),
        },
    );
    Ok(result)
}

/// Marker separating segments in a batched translation request.
const SEGMENT_MARKER: &str = "\n\n===SEGMENT_BREAK===\n\n";

/// Marker used to split the model's batched response back into segments.
const SEGMENT_SPLIT_MARKER: &str = "===SEGMENT_BREAK===";

fn choose_segment_marker(segments: &[String]) -> String {
    if segments
        .iter()
        .all(|segment| !segment.contains(SEGMENT_SPLIT_MARKER))
    {
        return SEGMENT_MARKER.to_string();
    }
    // Keep extending the counter until the marker provably cannot collide —
    // once it is longer than every segment, no segment can contain it.
    let mut index = 1u64;
    loop {
        let marker = format!("\n\n===VANISHTRANS_SEGMENT_{}===\n\n", index);
        if segments
            .iter()
            .all(|segment| !segment.contains(marker.trim()))
        {
            return marker;
        }
        index += 1;
    }
}

/// Join segments with a marker that cannot already occur in the source.
fn join_segments_with_marker(segments: &[String], marker: &str) -> String {
    segments.join(marker)
}

/// Join segments into one request payload.
#[cfg(test)]
fn join_segments(segments: &[String]) -> String {
    let marker = choose_segment_marker(segments);
    join_segments_with_marker(segments, &marker)
}

/// Count leading whitespace characters of `text`, capped at `limit`.
fn leading_whitespace_bounded(text: &str, limit: usize) -> usize {
    text.chars()
        .take(limit)
        .take_while(|c| c.is_whitespace())
        .count()
}

/// Count trailing whitespace characters of `text`, capped at `limit`.
fn trailing_whitespace_bounded(text: &str, limit: usize) -> usize {
    text.chars()
        .rev()
        .take(limit)
        .take_while(|c| c.is_whitespace())
        .count()
}

/// Split a batched translation result back into segments, removing only the
/// whitespace the marker join introduced around each boundary. Inner
/// whitespace is part of the segment (JSON values may be significant, e.g.
/// `" padded "`) and must survive the round trip. Returns
/// `SEGMENT_COUNT_MISMATCH` when the model merged or dropped segments, so the
/// caller can fall back to showing raw text instead of a broken reassembly.
fn split_translated_with_marker(
    result: &str,
    expected_len: usize,
    marker: &str,
) -> Result<Vec<String>, CommandError> {
    // The sentinel sits between segments; the marker's own leading whitespace
    // frames the *previous* segment's tail and its trailing whitespace frames
    // the *next* segment's head. Strip at most that many whitespace chars.
    let sentinel = marker.trim();
    let head_budget = marker.chars().count() - marker.trim_start().chars().count();
    let tail_budget = marker.chars().count() - marker.trim_end().chars().count();
    let pieces: Vec<&str> = result.split(sentinel).collect();
    let translated: Vec<String> = pieces
        .iter()
        .enumerate()
        .map(|(index, piece)| {
            let head = if index == 0 {
                0
            } else {
                leading_whitespace_bounded(piece, tail_budget)
            };
            let tail = if index + 1 == pieces.len() {
                0
            } else {
                trailing_whitespace_bounded(piece, head_budget)
            };
            let start = piece
                .char_indices()
                .nth(head)
                .map_or(piece.len(), |(offset, _)| offset);
            let end = if tail == 0 {
                piece.len()
            } else {
                piece
                    .char_indices()
                    .rev()
                    .nth(tail - 1)
                    .map_or(0, |(offset, _)| offset)
            };
            if start >= end {
                return String::new();
            }
            piece[start..end].to_string()
        })
        .collect();
    if translated.len() != expected_len {
        return Err(CommandError::new(
            code::SEGMENT_COUNT_MISMATCH,
            "分段数量与原文不一致",
        ));
    }
    Ok(translated)
}

#[cfg(test)]
fn split_translated(result: &str, expected_len: usize) -> Result<Vec<String>, CommandError> {
    split_translated_with_marker(result, expected_len, SEGMENT_MARKER)
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
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ApiConfig>,
    segments: Vec<String>,
    direction: String,
) -> Result<Vec<String>, CommandError> {
    if segments.is_empty() {
        return Ok(Vec::new());
    }

    let scope = window.label();
    let seq = state.next_request_seq(scope);
    let snapshot = state.translation_snapshot();

    let marker = choose_segment_marker(&segments);
    let combined = join_segments_with_marker(&segments, &marker);
    let target = crate::translate::resolve_target_lang(&combined, &direction);

    // The free Google provider does not understand the segment-break marker, so
    // translate each segment individually instead of sending one batched prompt.
    // Transient per-segment failures (429 / 5xx / network) retry with a short
    // supersede-aware backoff; exhausting attempts fails the batch naming the
    // segment index so the frontend can report where it stopped.
    if snapshot.free_translation {
        const FREE_BATCH_MAX_ATTEMPTS: u32 = 3;
        const FREE_BATCH_BACKOFF_MS: u64 = 400;
        let mut translated = Vec::with_capacity(segments.len());
        for (index, segment) in segments.iter().enumerate() {
            let mut attempt = 0u32;
            let text = loop {
                attempt += 1;
                match do_translate_unified_scoped(
                    &state, &snapshot, segment, "auto", target, scope, seq,
                )
                .await
                {
                    Ok(text) => break text,
                    Err(error) if error == "CANCELLED" => {
                        return Err(CommandError::cancelled());
                    }
                    Err(error)
                        if attempt < FREE_BATCH_MAX_ATTEMPTS
                            && crate::translate::is_transient_free_error(&error) =>
                    {
                        tokio::select! {
                            _ = tokio::time::sleep(
                                std::time::Duration::from_millis(FREE_BATCH_BACKOFF_MS)
                            ) => {}
                            _ = crate::translate::wait_for_request_superseded(
                                &state, scope, seq,
                            ) => return Err(CommandError::cancelled()),
                        }
                    }
                    Err(error) => {
                        return Err(map_translation_error(format!(
                            "第 {}/{} 段翻译失败: {}",
                            index + 1,
                            segments.len(),
                            error
                        )));
                    }
                }
            };
            if !state.is_current_request(scope, seq) {
                return Err(CommandError::cancelled());
            }
            translated.push(text);
            let _ = window.emit(
                "file-progress",
                FileProgressEvent {
                    completed: translated.len(),
                    total: segments.len(),
                },
            );
        }
        return Ok(translated);
    }

    let result =
        do_translate_unified_scoped(&state, &snapshot, &combined, "auto", target, scope, seq)
            .await
            .map_err(map_translation_error)?;

    if !state.is_current_request(scope, seq) {
        return Err(CommandError::cancelled());
    }

    split_translated_with_marker(&result, segments.len(), &marker)
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
    fn batch_marker_avoids_source_collisions() {
        let segments = vec![
            format!("before {} after", SEGMENT_SPLIT_MARKER),
            "second".to_string(),
        ];
        let marker = choose_segment_marker(&segments);
        assert!(!segments
            .iter()
            .any(|segment| segment.contains(marker.trim())));
        let joined = join_segments_with_marker(&segments, &marker);
        let translated = split_translated_with_marker(&joined, 2, &marker).unwrap();
        assert_eq!(translated, segments);
    }

    #[test]
    fn batch_marker_fallback_is_guaranteed_collision_free() {
        // The segment collides with the default sentinel plus several numbered
        // candidates — the counter loop has no fixed cap and must keep going.
        let mut blockers = vec![SEGMENT_SPLIT_MARKER.to_string()];
        blockers.extend((1..=5).map(|index| format!("===VANISHTRANS_SEGMENT_{}===", index)));
        let segments = vec![blockers.join(" ")];
        let marker = choose_segment_marker(&segments);
        assert!(marker.trim().contains("VANISHTRANS_SEGMENT_"));
        assert!(!segments[0].contains(marker.trim()));
    }

    #[test]
    fn split_translated_strips_only_join_framing() {
        // The joined framing around the sentinel is absorbed; stray model-added
        // whitespace beyond it stays with the segment.
        let translated = split_translated(" 你好 \n\n===SEGMENT_BREAK===\n\n world ", 2).unwrap();
        assert_eq!(
            translated,
            vec![" 你好 ".to_string(), " world ".to_string()]
        );
    }

    #[test]
    fn split_translated_preserves_significant_inner_whitespace() {
        // Whitespace-significant values (e.g. JSON `" padded "`) must survive
        // the batch round trip untrimmed.
        let segments = vec![" padded ".to_string(), "\tindented\n".to_string()];
        let marker = choose_segment_marker(&segments);
        let joined = join_segments_with_marker(&segments, &marker);
        let translated = split_translated_with_marker(&joined, 2, &marker).unwrap();
        assert_eq!(translated, segments);
    }

    #[test]
    fn split_translated_keeps_whitespace_on_a_single_segment() {
        let translated = split_translated("  hello  ", 1).unwrap();
        assert_eq!(translated, vec!["  hello  ".to_string()]);
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

    #[test]
    fn cancellation_errors_keep_the_stable_code() {
        let error = map_translation_error("CANCELLED".to_string());
        assert_eq!(error.code, code::CANCELLED);
        assert_eq!(error.message, "请求已取消");
    }

    #[test]
    fn api_errors_keep_the_stable_code() {
        let error = map_translation_error("译文因输出长度限制被截断，请缩短输入后重试".to_string());
        assert_eq!(error.code, code::API);
    }
}
