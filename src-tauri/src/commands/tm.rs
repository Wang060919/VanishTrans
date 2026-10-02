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
pub async fn get_tm_dir(
    app: tauri::AppHandle,
    config: tauri::State<'_, ApiConfig>,
) -> Result<TmDirInfo, CommandError> {
    let dir = config.tm_db_dir(&default_tm_dir(&app));
    Ok(TmDirInfo {
        is_default: config.tm_dir().trim().is_empty(),
        path: dir.to_string_lossy().into_owned(),
    })
}

/// Change where `tm.db` lives. `migrate` copies the current database into the
/// new directory first (never overwrites), then the live connection is
/// repointed so translations after this call write the new location — no
/// restart needed.
///
/// Ordering: the copy runs before the config is persisted so a failed copy
/// never leaves the saved path pointing at a directory without the database.
/// If persisting then fails, the copy this call made is removed so a retry
/// is not permanently blocked by its own leftover.
///
/// Reset semantics: an empty `path` (or a path that canonicalizes to the
/// app-data dir) restores the default location. A `tm.db` already in the
/// default dir can only be a database this app previously managed, so during
/// reset it is renamed to `tm.db.bak-*` before the live database is copied
/// in. For any other directory an existing `tm.db` is foreign data and the
/// move is refused.
#[tauri::command]
pub async fn set_tm_dir(
    app: tauri::AppHandle,
    config: tauri::State<'_, ApiConfig>,
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    path: String,
    migrate: bool,
) -> Result<(), CommandError> {
    let default_dir = default_tm_dir(&app);
    let target = resolve_tm_dir(&path, &default_dir)?;
    set_tm_dir_to(&config, &tm, &path, &target, &default_dir, migrate)
}

/// Split from the command so the ordering — copy, persist, reopen — can be
/// exercised without an AppHandle.
fn set_tm_dir_to(
    config: &ApiConfig,
    tm: &crate::tm::TranslationMemory,
    path: &str,
    target: &std::path::Path,
    default_dir: &std::path::Path,
    migrate: bool,
) -> Result<(), CommandError> {
    let target_is_default = canonical_or_self(target) == canonical_or_self(default_dir);
    let stored = if target_is_default {
        String::new()
    } else {
        target.to_string_lossy().into_owned()
    };
    // Only a bare reset (empty input) may move a default-dir tm.db aside; a
    // user-typed path that happens to resolve to the default keeps the
    // refuse-to-overwrite behavior of every other directory.
    let allow_quarantine = target_is_default && path.trim().is_empty();
    let copied_db = match migrate {
        // Reset path: migrate_db handles every dest state itself — fresh copy,
        // same-file no-op, or quarantine of the app-managed leftover.
        true if allow_quarantine => migrate_db(tm, target, true).map_err(CommandError::io)?,
        // Custom dir with the setting already persisted and a tm.db present:
        // a retry of an earlier call whose copy or reopen failed mid-way.
        // Skip the copy — reopen only reads the file (exactly what a restart
        // would do), so retries cannot wedge on refuse-to-overwrite and no
        // foreign data is clobbered.
        true if config.tm_dir() == stored && target.join("tm.db").exists() => false,
        true => migrate_db(tm, target, false).map_err(CommandError::io)?,
        false => false,
    };
    if let Err(error) = config.set_tm_dir(stored) {
        // Persisting failed: remove the tm.db this call copied so the next
        // attempt does not trip the refuse-to-overwrite guard. Either the
        // file did not exist before this call or this call quarantined it,
        // so pre-existing data is never deleted here.
        if copied_db {
            let _ = std::fs::remove_file(target.join("tm.db"));
        }
        return Err(CommandError::io(error));
    }
    // Persisting succeeded; only now swap the live connection. If this fails
    // the saved setting still takes effect on restart, so report loudly.
    tm.reopen(target).map_err(|error| {
        log::error!("[tm] live reopen to {} failed: {error}", target.display());
        CommandError::io(format!("切换翻译记忆目录失败（重启后生效）: {error}"))
    })
}

/// Copy the live `tm.db` into `target`. Returns whether the destination file
/// was created by this call (for rollback after a failed persist). With
/// `allow_quarantine`, an existing destination file — reachable only via the
/// reset-to-default path, where it is always an app-managed leftover — is
/// renamed to a `.bak` sibling instead of refusing; without it `copy_db_to`
/// keeps refusing to overwrite a foreign database.
fn migrate_db(
    tm: &crate::tm::TranslationMemory,
    target: &std::path::Path,
    allow_quarantine: bool,
) -> Result<bool, String> {
    let dest = target.join("tm.db");
    let existed_before = dest.exists();
    if let Err(first_error) = tm.copy_db_to(target) {
        if !(allow_quarantine && dest.exists()) {
            // Foreign tm.db or a real copy failure surfaces unchanged.
            return Err(first_error);
        }
        let backup = quarantined_db_name(target);
        std::fs::rename(&dest, &backup)
            .map_err(|error| format!("无法移开默认目录已有的 tm.db：{error}"))?;
        return match tm.copy_db_to(target) {
            Ok(()) => Ok(true),
            Err(error) => {
                // Migration still failed (e.g. transient in-memory mode):
                // drop any partial copy and put the original back so the
                // error leaves nothing moved.
                if dest.exists() {
                    let _ = std::fs::remove_file(&dest);
                }
                if std::fs::rename(&backup, &dest).is_err() {
                    Err(format!(
                        "{error}（原有数据库已保留为 {}）",
                        backup.display()
                    ))
                } else {
                    Err(error)
                }
            }
        };
    }
    // copy_db_to refuses when dest exists, so a successful call created the
    // destination file exactly when it was absent beforehand — the same-file
    // no-op (reset while the live db already is the default) is excluded.
    Ok(!existed_before)
}

/// Unique sibling name for a quarantined default-dir `tm.db`; the original
/// bytes are preserved so no data is ever discarded.
fn quarantined_db_name(target: &std::path::Path) -> std::path::PathBuf {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    loop {
        let candidate = target.join(format!(
            "tm.db.bak-{timestamp}-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        if !candidate.try_exists().unwrap_or(false) {
            return candidate;
        }
    }
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
pub async fn tm_search(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    query: Option<String>,
) -> Result<Vec<crate::tm::TmEntry>, CommandError> {
    Ok(tm.search(query.as_deref().unwrap_or("")))
}

#[tauri::command]
pub async fn tm_delete(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    id: i64,
) -> Result<(), CommandError> {
    tm.delete(id).map_err(CommandError::io)
}

#[tauri::command]
pub async fn tm_clear(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
) -> Result<(), CommandError> {
    tm.clear().map_err(CommandError::io)
}

#[tauri::command]
pub async fn tm_stats(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
) -> Result<crate::tm::TmStats, CommandError> {
    Ok(tm.stats())
}

#[tauri::command]
pub async fn tm_export(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    path: String,
) -> Result<usize, CommandError> {
    tm.export_csv(std::path::Path::new(&path))
        .map_err(CommandError::io)
}

#[tauri::command]
pub async fn tm_import(
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
pub async fn tm_import_content(
    tm: tauri::State<'_, crate::tm::TranslationMemory>,
    config: tauri::State<'_, ApiConfig>,
    content: String,
) -> Result<usize, CommandError> {
    tm.import_csv_content_for_context(&content, &config.translation_context_hash())
        .map_err(CommandError::io)
}

#[cfg(test)]
#[path = "tm_dir_tests.rs"]
mod tm_dir_tests;
