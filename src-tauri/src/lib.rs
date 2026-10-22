#![allow(deprecated)]

use std::sync::Mutex;

use tauri::Manager;
use tauri::{
    PhysicalPosition, PhysicalSize, WindowEvent, Wry,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_window_state::StateFlags;

struct AppState {
    hide_menu_item: Mutex<Option<MenuItem<Wry>>>,
    size: Mutex<PhysicalSize<u32>>,
    position: Mutex<PhysicalPosition<i32>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .with_state_flags(StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            hide_menu_item: Mutex::new(None),
            size: Mutex::new(PhysicalSize {
                width: 0,
                height: 0,
            }),
            position: Mutex::new(PhysicalPosition { x: 0, y: 0 }),
        })
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&hide, &quit])?;
            let window = app.get_webview_window("main").unwrap();
            // let _ = window.as_ref().window().move_window(Position::TopRight);
            let window_clone = window.clone();
            let window_clone2 = window.clone();

            let app_handle = app.handle();
            let app_state = app_handle.state::<AppState>();
            let size: PhysicalSize<u32> = window_clone.inner_size().unwrap();
            let position: PhysicalPosition<i32> = window_clone.outer_position().unwrap();

            {
                *app_state.hide_menu_item.lock().unwrap() = Some(hide.clone());
                *app_state.size.lock().unwrap() = size;
                *app_state.position.lock().unwrap() = position;
            }

            let _ = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "hide" => {
                        if window_clone.is_visible().unwrap_or_default() {
                            window_clone.hide().expect("hide window");
                            hide.set_text("Show").expect("set text");
                        } else {
                            let app_state = window_clone.state::<AppState>();
                            let position = app_state.position.lock().unwrap().to_owned();

                            window_clone.show().expect("show window");
                            hide.set_text("Hide").expect("set text");

                            #[cfg(not(target_os = "linux"))]
                            {
                                let size = app_state.size.lock().unwrap().to_owned();
                                window_clone.set_size(size).unwrap();
                            }

                            println!("pos: {position:?}");

                            window_clone.set_position(position).unwrap();
                        };
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {
                        println!("menu item {:?} not handled", event.id);
                    }
                })
                .on_tray_icon_event(move |_, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        let app_state = window_clone2.state::<AppState>();
                        let hide_menu_item = app_state.hide_menu_item.lock().unwrap();

                        if window_clone2.is_visible().unwrap_or_default() {
                            if let Some(hide) = hide_menu_item.as_ref() {
                                hide.set_text("Hide").expect("set text");
                            }
                        } else {
                            let size = app_state.size.lock().unwrap().to_owned();
                            let position = app_state.position.lock().unwrap().to_owned();

                            window_clone2.unminimize().unwrap();
                            window_clone2.show().unwrap();

                            if let Some(hide) = hide_menu_item.as_ref() {
                                hide.set_text("Show").expect("set text");
                            }

                            window_clone2.set_size(size).unwrap();
                            window_clone2.set_position(position).unwrap();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let app_state = window.state::<AppState>();
                let hide_menu_item = app_state.hide_menu_item.lock().unwrap();
                if let Some(hide) = hide_menu_item.as_ref() {
                    hide.set_text("Show").expect("set text");
                }
                window.hide().expect("hide window");
                api.prevent_close();
            }
            WindowEvent::Moved(position, ..) => {
                // Handle window move event if needed
                if position.x > -20000 && position.y > -20000 {
                    let app_state = window.state::<AppState>();
                    let mut pos_lock = app_state.position.lock().unwrap();
                    *pos_lock = *position;
                }
            }
            WindowEvent::Resized(size, ..) => {
                // Handle window resize event if needed
                let app_state = window.state::<AppState>();

                if size.width == 0 && size.height == 0 {
                    let hide_menu_item = app_state.hide_menu_item.lock().unwrap();
                    if let Some(hide) = hide_menu_item.as_ref() {
                        hide.set_text("Show").expect("set text");
                    }
                    window.hide().expect("hide window");
                } else {
                    let mut size_lock = app_state.size.lock().unwrap();
                    *size_lock = *size;
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())?;

    Ok(())
}
