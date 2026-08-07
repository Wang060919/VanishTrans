use crate::error::CommandError;
use crate::history::HistoryStore;

// -----------------------------------------------------------
// History commands
// -----------------------------------------------------------

#[tauri::command]
pub fn get_history(
    history: tauri::State<'_, HistoryStore>,
    query: Option<String>,
) -> Result<Vec<serde_json::Value>, CommandError> {
    let records = match query.as_deref() {
        Some(q) if !q.is_empty() => history.search(q),
        _ => history.get_all(),
    };
    Ok(records
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "original": r.original,
                "translated": r.translated,
                "direction": r.direction,
                "timestamp": r.timestamp,
            })
        })
        .collect())
}

#[tauri::command]
pub fn delete_history_record(
    history: tauri::State<'_, HistoryStore>,
    id: u64,
) -> Result<(), CommandError> {
    history.delete(id).map_err(CommandError::io)
}

#[tauri::command]
pub fn clear_history(history: tauri::State<'_, HistoryStore>) -> Result<(), CommandError> {
    history.clear().map_err(CommandError::io)
}
