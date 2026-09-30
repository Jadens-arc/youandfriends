//! The You & Friends Mac sync agent's logic (task `111` onwards, ADR 0005).
//!
//! Everything that can be platform-independent lives here, so it builds and is tested on any
//! machine: the state the menu-bar shows now, and — in tasks `112`–`115` — watching, ignore
//! rules, the manifest, the ZIP, and the upload protocol. The Tauri app in `src-tauri` is a thin
//! macOS shell around it, and holds no logic worth testing on its own.

pub mod status;

pub use status::{AgentState, AgentStatus};
