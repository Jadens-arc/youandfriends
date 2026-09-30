//! You & Friends Sync (task `111`): a menu-bar agent for macOS, and only macOS.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod app;

#[cfg(target_os = "macos")]
fn main() {
    app::run();
}

/// Anywhere else: say so plainly, and exit non-zero. Never a window that half-works.
#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!(
        "SKIPPED: You & Friends Sync is a macOS menu-bar app and runs only on macOS. \
         The logic it wraps is in `youandfriends-sync-core`, which builds and tests everywhere."
    );
    std::process::exit(2);
}
