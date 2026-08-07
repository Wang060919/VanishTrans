use crate::error::CommandError;
use crate::translate::ApiConfig;

// -----------------------------------------------------------
// Translation Memory commands
// -----------------------------------------------------------

#[tauri::command]
pub fn tm_search(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    query: Option<String>,
) -> Result<Vec<crate::tm::TmEntry>, CommandError> {
    Ok(tm.search(query.as_deref().unwrap_or("")))
}

#[tauri::command]
pub fn tm_delete(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    id: i64,
) -> Result<(), CommandError> {
    tm.delete(id).map_err(CommandError::io)
}

#[tauri::command]
pub fn tm_clear(tm: tauri::State<'_, crate::tm::TranslationMemory>) -> Result<(), CommandError> {
    tm.clear().map_err(CommandError::io)
}

#[tauri::command]
pub fn tm_stats(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
) -> Result<crate::tm::TmStats, CommandError> {
    Ok(tm.stats())
}

#[tauri::command]
pub fn tm_export(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    path: String,
) -> Result<usize, CommandError> {
    tm.export_csv(std::path::Path::new(&path))
        .map_err(CommandError::io)
}

#[tauri::command]
pub fn tm_import(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    config: tauri::State<'_, ApiConfig>,
    path: String,
) -> Result<usize, CommandError> {
    tm.import_csv_for_context(
        std::path::Path::new(&path),
        &config.translation_context_hash(),
    )
    .map_err(CommandError::io)
}

#[tauri::command]
pub fn tm_import_content(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    config: tauri::State<'_, ApiConfig>,
    content: String,
) -> Result<usize, CommandError> {
    tm.import_csv_content_for_context(&content, &config.translation_context_hash())
        .map_err(CommandError::io)
}
