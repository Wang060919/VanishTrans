use crate::error::CommandError;
use crate::translate::ApiConfig;
use tauri::Manager;

// -----------------------------------------------------------
// Translation Memory commands
// -----------------------------------------------------------

#[derive(serde::Serialize)]
pub struct TmDirInfo {
    pub path: String,
    pub is_default: bool,
}

fn default_tm_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn canonical_or_self(dir: &std::path::Path) -> std::path::PathBuf {
    std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf())
}

/// Effective TM directory: the configured override, or the app-data default.
#[tauri::command]
pub fn get_tm_dir(
    app: tauri::AppHandle,
    config: tauri::State<'_, ApiConfig>,
) -> Result<TmDirInfo, CommandError> {
    let dir = config.tm_db_dir(&default_tm_dir(&app));
    Ok(TmDirInfo {
        is_default: config.tm_dir().trim().is_empty(),
        path: dir.to_string_lossy().into_owned(),
    })
}

/// Change where `tm.db` lives. Takes effect on restart; `migrate` copies the
/// current database into the new directory first (never overwrites).
#[tauri::command]
pub fn set_tm_dir(
    app: tauri::AppHandle,
    config: tauri::State<'_, ApiConfig>,
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    path: String,
    migrate: bool,
) -> Result<(), CommandError> {
    let default_dir = default_tm_dir(&app);
    let target = resolve_tm_dir(&path, &default_dir)?;
    if migrate {
        tm.copy_db_to(&target).map_err(CommandError::io)?;
    }
    let stored = if canonical_or_self(&target) == canonical_or_self(&default_dir) {
        String::new()
    } else {
        target.to_string_lossy().into_owned()
    };
    config.set_tm_dir(stored).map_err(CommandError::io)
}

/// Empty input resolves to `default_dir`; anything else must be an absolute
/// path that exists (or can be created) and accepts writes.
fn resolve_tm_dir(
    input: &str,
    default_dir: &std::path::Path,
) -> Result<std::path::PathBuf, CommandError> {
    let trimmed = input.trim();
    let dir = if trimmed.is_empty() {
        default_dir.to_path_buf()
    } else {
        let dir = std::path::PathBuf::from(trimmed);
        if !dir.is_absolute() {
            return Err(CommandError::validation("请输入绝对路径"));
        }
        dir
    };
    std::fs::create_dir_all(&dir).map_err(|e| CommandError::io(format!("创建目录失败: {e}")))?;
    // Writability probe — the same thing SQLite needs for tm.db.
    let probe = dir.join(".vt_write_probe");
    std::fs::write(&probe, b"vt")
        .and_then(|_| std::fs::remove_file(&probe))
        .map_err(|e| CommandError::io(format!("目录不可写: {e}")))?;
    Ok(dir)
}

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
