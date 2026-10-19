use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use futures_util::StreamExt;
use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Mutex};

use crate::error::CommandError;

#[derive(Default)]
pub struct ShortcutState(Mutex<Option<ActiveSession>>);
struct ActiveSession {
    stop: oneshot::Sender<()>,
    closed: oneshot::Receiver<Result<(), CommandError>>,
    labels: Vec<String>,
}

/// Bind once per live session; disabling explicitly closes the portal session.
pub async fn configure(
    app: tauri::AppHandle,
    enabled: Option<bool>,
) -> Result<Vec<String>, CommandError> {
    let state = app.state::<ShortcutState>();
    let mut active = state.0.lock().await;
    if enabled.is_none() {
        return Ok(active
            .as_ref()
            .filter(|session| !session.stop.is_closed())
            .map(|session| session.labels.clone())
            .unwrap_or_default());
    }
    if enabled == Some(false) {
        if let Some(session) = active.take() {
            let _ = session.stop.send(());
            session
                .closed
                .await
                .map_err(|_| CommandError::internal("快捷键会话退出失败，请重启应用。"))??;
        }
        return Ok(Vec::new());
    }
    if let Some(session) = active.as_ref().filter(|session| !session.stop.is_closed()) {
        return Ok(session.labels.clone());
    }
    let proxy = GlobalShortcuts::new().await.map_err(super::portal_error)?;
    let session = proxy.create_session().await.map_err(super::portal_error)?;
    let shortcuts = [
        NewShortcut::new("open", "打开 VanishTrans"),
        NewShortcut::new("ocr", "截图 OCR（识别后预览，不自动翻译）"),
    ];
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        proxy.bind_shortcuts(&session, &shortcuts, None),
    )
    .await;
    let result = match result {
        Ok(result) => result,
        Err(_) => {
            let _ = session.close().await;
            return Err(CommandError::io("桌面快捷键授权超时，请重试。"));
        }
    };
    let bound = match result.and_then(|request| request.response()) {
        Ok(bound) => bound,
        Err(error) => {
            let _ = session.close().await;
            return Err(super::portal_error(error));
        }
    };
    let labels: Vec<_> = bound
        .shortcuts()
        .iter()
        .map(|shortcut| {
            format!(
                "{}：{}",
                shortcut.description(),
                shortcut.trigger_description()
            )
        })
        .collect();
    if labels.is_empty() {
        let _ = session.close().await;
        return Err(CommandError::validation("未授权任何快捷键。"));
    }
    let mut events = match proxy.receive_activated().await {
        Ok(events) => events,
        Err(error) => {
            let _ = session.close().await;
            return Err(super::portal_error(error));
        }
    };
    let session_path = serde_json::to_value(&session)
        .map_err(|_| CommandError::internal("无法读取快捷键会话标识。"))?;
    let mut closed = match session.receive_closed().await {
        Ok(closed) => closed,
        Err(error) => {
            let _ = session.close().await;
            return Err(super::portal_error(error));
        }
    };
    let (stop, mut stopped) = oneshot::channel();
    let (done, closed_ack) = oneshot::channel();
    *active = Some(ActiveSession {
        stop,
        closed: closed_ack,
        labels: labels.clone(),
    });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stopped => break,
                _ = closed.next() => break,
                event = events.next() => {
                    let Some(event) = event else { break };
                    if session_path.as_str() != Some(event.session_handle().as_str()) { continue; }
                    if !matches!(event.shortcut_id(), "open" | "ocr") { continue; }
                    if let Some(window) = handle.get_webview_window("ball") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        if event.shortcut_id() == "ocr" {
                            let _ = window.emit("linux-screenshot-request", ());
                        }
                    }
                }
            }
        }
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), session.close())
            .await
            .map_err(|_| CommandError::io("桌面快捷键关闭超时，请重启应用后再授权。"))
            .and_then(|result| result.map_err(super::portal_error));
        let _ = handle.emit("linux-shortcuts-stopped", ());
        let _ = done.send(result);
    });
    Ok(labels)
}
