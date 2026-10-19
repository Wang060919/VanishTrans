//! Conservative Linux core shell; no global input hooks or compositor positioning.
use crate::lock::LockRecover;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub(crate) fn setup(app: &tauri::App) {
    #[cfg(target_os = "linux")]
    app.manage(crate::linux_portal::ShortcutState::default());
    app.state::<crate::StartupWarnings>().0.lock_recover().push(
        "Linux 实验版：可在设置中授权桌面快捷键。截图 OCR 需要 Tesseract 和语言包，识别结果先预览再手动翻译。划词、原地替换和灵动岛仍未启用；KDE Wayland 实机兼容性待验证。".into(),
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
