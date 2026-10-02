use tauri::Manager;

use crate::error::CommandError;
use crate::history::HistoryStore;
use crate::lock::LockRecover;
use crate::translate::{test_connection_async, ApiConfig, ServiceProfile};

// -----------------------------------------------------------
// API config commands
// -----------------------------------------------------------

#[tauri::command]
pub fn get_api_config(
    state: tauri::State<'_, ApiConfig>,
) -> Result<serde_json::Value, CommandError> {
    // Hold the write lock while reading every field so a save that lands
    // mid-read cannot produce a mixed old/new snapshot.
    let _write_guard = state.lock_for_write();
    Ok(serde_json::json!({
        "baseUrl": *state.base_url.lock_recover(),
        "hasApiKey": !state.api_key.lock_recover().is_empty(),
        "model": *state.model.lock_recover(),
        "hotkeys": *state.hotkeys.lock_recover(),
        "glossary": *state.glossary.lock_recover(),
        "maxRecords": state.max_records.load(std::sync::atomic::Ordering::Relaxed),
        "profiles": *state.profiles.lock_recover(),
        "freeTranslation": state.free_translation(),
    }))
}

#[tauri::command]
pub fn set_api_config(
    state: tauri::State<'_, ApiConfig>,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<(), CommandError> {
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    let model = model.trim().to_string();
    if base_url.is_empty() {
        return Err(CommandError::validation("Base URL 不能为空"));
    }
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(CommandError::validation(
            "Base URL 必须以 http:// 或 https:// 开头",
        ));
    }
    if model.is_empty() {
        return Err(CommandError::validation("模型名称不能为空"));
    }

    let _write_guard = state.lock_for_write();
    let snapshot = state.snapshot();
    if let Some(new_key) = api_key.as_ref() {
        // Store the key exactly as it will be sent: test_connection trims
        // before use, so persisting an untrimmed key would test OK and then
        // 401 on real calls.
        *state.api_key.lock_recover() = new_key.trim().to_string();
    }
    *state.base_url.lock_recover() = base_url;
    *state.model.lock_recover() = model;

    if let Err(error) = state.save_to_disk() {
        state.restore(&snapshot);
        return Err(CommandError::io(error));
    }
    if api_key.is_some() {
        if let Err(error) = state.save_api_key() {
            state.restore(&snapshot);
            let _ = state.save_to_disk();
            let _ = state.save_api_key();
            return Err(CommandError::io(error));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_hotkeys(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiConfig>,
    hotkeys: Vec<(String, String)>,
) -> Result<(), CommandError> {
    let _write_guard = state.lock_for_write();
    let snapshot = state.snapshot();
    *state.hotkeys.lock_recover() = hotkeys;
    if let Err(error) = crate::setup::sync_shortcuts(&app) {
        state.restore(&snapshot);
        let _ = crate::setup::sync_shortcuts(&app);
        return Err(CommandError::validation(format!(
            "快捷键更新失败: {}",
            error
        )));
    }
    if let Err(error) = state.save_to_disk() {
        state.restore(&snapshot);
        let _ = crate::setup::sync_shortcuts(&app);
        return Err(CommandError::io(error));
    }
    Ok(())
}

/// Transiently suspend or resume global hotkeys while the settings hotkey
/// recorder captures a combo. Reference-counted: every suspend needs a
/// matching resume, and the count is independent of the tray pause flag so
/// resuming can never re-enable shortcuts the user paused manually.
#[tauri::command]
pub fn set_shortcuts_suspended(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    suspended: bool,
) -> Result<(), CommandError> {
    let counter = &state.shortcut_suspend_count;
    // Remember whether this call actually moved the count so a failed
    // sync can undo exactly our own delta instead of restoring a stale
    // value that would erase a concurrent suspend/resume.
    let changed = if suspended {
        counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        true
    } else {
        // An unmatched resume (e.g. a recorder that never suspended) must not
        // underflow the count.
        counter
            .fetch_update(
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
                |count| count.checked_sub(1),
            )
            .is_ok()
    };
    if let Err(error) = crate::setup::sync_shortcuts(&app) {
        if changed {
            // Compare-exchange undo: removes only the delta this call added,
            // leaving increments/decrements from racing callers untouched.
            let _ = counter.fetch_update(
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
                |count| {
                    if suspended {
                        count.checked_sub(1)
                    } else {
                        count.checked_add(1)
                    }
                },
            );
        }
        return Err(CommandError::internal(format!(
            "快捷键状态更新失败: {error}"
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn set_glossary(
    state: tauri::State<'_, ApiConfig>,
    glossary: Vec<(String, String)>,
) -> Result<(), CommandError> {
    let _write_guard = state.lock_for_write();
    let snapshot = state.snapshot();
    *state.glossary.lock_recover() = glossary;
    if let Err(error) = state.save_to_disk() {
        state.restore(&snapshot);
        return Err(CommandError::io(error));
    }
    Ok(())
}

#[tauri::command]
pub fn set_free_translation(
    state: tauri::State<'_, ApiConfig>,
    enabled: bool,
) -> Result<(), CommandError> {
    state
        .set_free_translation(enabled)
        .map_err(CommandError::io)
}

#[tauri::command]
pub fn set_max_records(
    app: tauri::AppHandle,
    state: tauri::State<'_, ApiConfig>,
    max_records: usize,
) -> Result<(), CommandError> {
    let max = max_records.clamp(50, 1000);
    let _write_guard = state.lock_for_write();
    let snapshot = state.snapshot();
    state
        .max_records
        .store(max, std::sync::atomic::Ordering::Relaxed);
    if let Err(error) = state.save_to_disk() {
        state.restore(&snapshot);
        return Err(CommandError::io(error));
    }
    // Update HistoryStore limit only after the config is durable.
    app.state::<HistoryStore>().set_max_records(max);
    Ok(())
}

// -----------------------------------------------------------
// Service profiles + connection test
// -----------------------------------------------------------

#[tauri::command]
pub fn list_service_profiles(
    state: tauri::State<'_, ApiConfig>,
) -> Result<Vec<ServiceProfile>, CommandError> {
    Ok(state.profiles.lock_recover().clone())
}

#[tauri::command]
pub fn save_service_profile(
    state: tauri::State<'_, ApiConfig>,
    name: String,
    base_url: String,
    model: String,
) -> Result<Vec<ServiceProfile>, CommandError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(CommandError::validation("档案名称不能为空"));
    }
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    let model = model.trim().to_string();
    if base_url.is_empty() {
        return Err(CommandError::validation("Base URL 不能为空"));
    }
    // Match set_api_config: a stored profile must never carry a URL the
    // live config would reject, or apply would poison it.
    if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(CommandError::validation(
            "Base URL 必须以 http:// 或 https:// 开头",
        ));
    }
    if model.is_empty() {
        return Err(CommandError::validation("模型名称不能为空"));
    }
    state
        .upsert_profile(ServiceProfile {
            name,
            base_url,
            model,
        })
        .map_err(CommandError::io)
}

#[tauri::command]
pub fn delete_service_profile(
    state: tauri::State<'_, ApiConfig>,
    name: String,
) -> Result<Vec<ServiceProfile>, CommandError> {
    state.delete_profile(name.trim()).map_err(CommandError::io)
}

#[tauri::command]
pub fn apply_service_profile(
    state: tauri::State<'_, ApiConfig>,
    name: String,
) -> Result<ServiceProfile, CommandError> {
    // The applied profile is returned from inside the write lock, so a
    // successful apply can never report not-found after the fact.
    state.apply_profile(name.trim()).map_err(CommandError::io)
}

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, ApiConfig>,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<String, CommandError> {
    // Trim at the command boundary: everything downstream treats these as
    // exact strings, and only whitespace differs from what we persist.
    let base_url = base_url.trim().to_string();
    let model = model.trim().to_string();
    let api_key = match api_key {
        Some(key) if !key.trim().is_empty() => key.trim().to_string(),
        _ => state.api_key.lock_recover().clone(),
    };
    test_connection_async(&state, &base_url, &api_key, &model)
        .await
        .map_err(CommandError::api)
}
