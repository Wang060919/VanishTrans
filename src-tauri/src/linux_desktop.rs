//! Conservative Linux core shell; no global input hooks or compositor positioning.
use crate::lock::LockRecover;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub(crate) fn setup(app: &tauri::App) {
    app.state::<crate::StartupWarnings>().0.lock_recover().push(
        "Linux 核心版：请手动输入或粘贴文本。API Key 仅在本次运行中保留，重启后需重新输入；全局快捷键、划词、原地替换、截图 OCR 和灵动岛暂未启用。".into(),
    );
    // A missing StatusNotifier/AppIndicator host must never prevent translation.
    if let Err(error) = setup_tray(app) {
        log::warn!("[linux] tray unavailable: {error}");
    }
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show-core", "打开 VanishTrans", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit-core", "退出", true, None::<&str>)?;
    let rgba = image::load_from_memory(include_bytes!("../icons/tray-icon.png"))?.to_rgba8();
    let (width, height) = rgba.dimensions();
    TrayIconBuilder::with_id("linux-tray")
        .icon(tauri::image::Image::new_owned(
            rgba.into_raw(),
            width,
            height,
        ))
        .menu(&Menu::with_items(app, &[&show, &quit])?)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-core" => {
                if let Some(window) = app.get_webview_window("ball") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit-core" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
