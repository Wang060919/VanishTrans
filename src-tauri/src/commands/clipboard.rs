use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::clipboard::ClipboardGuard;
use crate::error::{code, CommandError};

// -----------------------------------------------------------
// Clipboard commands
// -----------------------------------------------------------

#[tauri::command]
pub fn read_clipboard_safe(
    app: tauri::AppHandle,
    guard: tauri::State<'_, ClipboardGuard>,
) -> Result<String, CommandError> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| CommandError::io(format!("读取剪贴板失败: {}", e)))?;
    if text.trim().is_empty() {
        return Err(CommandError::validation("剪贴板为空"));
    }
    if guard.is_own_content(&text) {
        guard.clear_dirty();
        return Err(CommandError::new(
            code::SKIP_OWN_CONTENT,
            "剪贴板内容来自本应用",
        ));
    }
    Ok(text)
}

#[tauri::command]
pub fn write_clipboard_safe(
    app: tauri::AppHandle,
    guard: tauri::State<'_, ClipboardGuard>,
    text: String,
) -> Result<(), CommandError> {
    app.clipboard()
        .write_text(text.clone())
        .map_err(|e| CommandError::io(format!("写入剪贴板失败: {}", e)))?;
    guard.mark_written(&text);
    Ok(())
}

// -----------------------------------------------------------
// Text cleanup command
// -----------------------------------------------------------

#[tauri::command]
pub fn cleanup_clipboard_text(text: String) -> Result<String, CommandError> {
    let cleaned = text.replace("\r\n", "\n").replace("-\n", "");
    Ok(cleaned.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_replaces_crlf_with_lf() {
        assert_eq!(cleanup_clipboard_text("a\r\nb".into()).unwrap(), "a\nb");
    }

    #[test]
    fn cleanup_preserves_line_breaks() {
        assert_eq!(cleanup_clipboard_text("a\nb".into()).unwrap(), "a\nb");
    }

    #[test]
    fn cleanup_merges_hyphen_line_breaks() {
        assert_eq!(
            cleanup_clipboard_text("computa-\ntion".into()).unwrap(),
            "computation"
        );
    }

    #[test]
    fn cleanup_trims_whitespace() {
        assert_eq!(cleanup_clipboard_text("  hello  ".into()).unwrap(), "hello");
    }

    #[test]
    fn cleanup_handles_empty_string() {
        assert_eq!(cleanup_clipboard_text("".into()).unwrap(), "");
    }

    #[test]
    fn cleanup_preserves_normal_text() {
        assert_eq!(
            cleanup_clipboard_text("hello world".into()).unwrap(),
            "hello world"
        );
    }
}
