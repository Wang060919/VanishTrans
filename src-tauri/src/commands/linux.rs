use crate::error::CommandError;

#[tauri::command]
pub async fn configure_linux_shortcuts(
    app: tauri::AppHandle,
    enabled: Option<bool>,
) -> Result<Vec<String>, CommandError> {
    #[cfg(target_os = "linux")]
    {
        crate::linux_portal::configure(app, enabled).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, enabled);
        Err(CommandError::validation("此功能仅适用于 Linux。"))
    }
}

#[tauri::command]
pub async fn linux_screenshot_ocr(language: String) -> Result<String, CommandError> {
    #[cfg(target_os = "linux")]
    {
        crate::linux_portal::recognize(language).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = language;
        Err(CommandError::validation("此功能仅适用于 Linux。"))
    }
}
