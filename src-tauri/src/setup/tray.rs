use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

use crate::{toggle_clipboard_watch, toggle_main, toggle_shortcuts, toggle_top};
use crate::{ShortcutsMenuItem, WatchMenuItem};

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let si = MenuItem::with_id(app, "show", "显示 / 隐藏", true, None::<&str>)?;
    let pi = MenuItem::with_id(app, "pin", "固定置顶", true, None::<&str>)?;
    let ti = MenuItem::with_id(
        app,
        "toggle_shortcuts",
        "暂停热键监听",
        true,
        None::<&str>,
    )?;
    let wi = MenuItem::with_id(
        app,
        "toggle_watch",
        "开启剪贴板监听",
        true,
        None::<&str>,
    )?;
    let qi = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    app.manage(ShortcutsMenuItem(ti.clone()));
    app.manage(WatchMenuItem(wi.clone()));

    let tray_rgba = ::image::load_from_memory(include_bytes!("../../icons/tray-icon.png"))?
        .to_rgba8();
    let (tray_width, tray_height) = tray_rgba.dimensions();
    let tray_icon = tauri::image::Image::new_owned(tray_rgba.into_raw(), tray_width, tray_height);

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .menu(&Menu::with_items(app, &[&si, &pi, &ti, &wi, &qi])?)
        .tooltip("VanishTrans · 快捷翻译")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => toggle_main(app),
            "pin" => toggle_top(app),
            "toggle_shortcuts" => toggle_shortcuts(app),
            "toggle_watch" => toggle_clipboard_watch(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
