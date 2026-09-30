//! The macOS shell: a tray icon with a small menu, a hidden window it opens, and one command.
//!
//! - **No dock icon.** The activation policy is `Accessory`, and `Info.plist` sets `LSUIElement`,
//!   so the agent lives in the menu bar only — a background sync agent bouncing in the dock is
//!   wrong (task `111`).
//! - **A narrow command surface.** One command, `agent_status`, returning a closed, typed status.
//!   No file-system command exists, and no plugin that adds one is loaded. Every command is
//!   declared in `build.rs` and allowed by name in `capabilities/default.json`.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{ActivationPolicy, Manager};
use youandfriends_sync_core::{AgentState, AgentStatus};

/// What the agent is doing. Until pairing arrives (task `116`), it is unpaired — the truth.
#[tauri::command]
fn agent_status() -> AgentStatus {
    AgentStatus::new(AgentState::Unpaired)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![agent_status])
        .setup(|app| {
            app.set_activation_policy(ActivationPolicy::Accessory);

            let status = AgentStatus::new(AgentState::Unpaired);
            let summary = MenuItem::with_id(app, "status", &status.summary, false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open You & Friends Sync…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&summary, &open, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("You & Friends Sync")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone()).icon_as_template(true);
            }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("You & Friends Sync failed to start");
}
