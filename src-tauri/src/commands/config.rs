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
        *state.api_key.lock_recover() = new_key.clone();
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
    if model.is_empty() {
        return Err(CommandError::validation("模型名称不能为空"));
    }
    state
        .upsert_profile(ServiceProfile {
            name,
            base_url,
            model,
        })
        .map_err(CommandError::io)?;
    Ok(state.profiles.lock_recover().clone())
}

#[tauri::command]
pub fn delete_service_profile(
    state: tauri::State<'_, ApiConfig>,
    name: String,
) -> Result<Vec<ServiceProfile>, CommandError> {
    state
        .delete_profile(name.trim())
        .map_err(CommandError::io)?;
    Ok(state.profiles.lock_recover().clone())
}

#[tauri::command]
pub fn apply_service_profile(
    state: tauri::State<'_, ApiConfig>,
    name: String,
) -> Result<ServiceProfile, CommandError> {
    state.apply_profile(name.trim()).map_err(CommandError::io)?;
    let profiles = state.profiles.lock_recover();
    profiles
        .iter()
        .find(|profile| profile.name == name.trim())
        .cloned()
        .ok_or_else(|| CommandError::not_found("找不到服务档案"))
}

#[tauri::command]
pub async fn test_connection(
    state: tauri::State<'_, ApiConfig>,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<String, CommandError> {
    let api_key = match api_key {
        Some(key) if !key.trim().is_empty() => key,
        _ => state.api_key.lock_recover().clone(),
    };
    test_connection_async(&state, &base_url, &api_key, &model)
        .await
        .map_err(CommandError::api)
}
