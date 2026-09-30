//! Declares the app's commands to Tauri (macOS only), so each needs a permission a capability
//! grants — the command surface is an allow-list from the first build, never "everything".
fn main() {
    #[cfg(target_os = "macos")]
    {
        let manifest = tauri_build::AppManifest::new().commands(&["agent_status"]);
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
            .expect("tauri build configuration");
    }
}
