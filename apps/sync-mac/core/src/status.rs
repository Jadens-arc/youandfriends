//! What the agent is doing, as the menu bar and its window show it.
//!
//! This is the whole of what crosses from the Rust side to the UI in task `111`: a closed set of
//! states, each with its own words. The UI never receives a path to act on, a token, or anything
//! it could turn into a filesystem request (`docs/THREAT_MODEL.md` T7).

use serde::Serialize;

/// Where the agent is. A closed set: a state the UI cannot name is a state it cannot misreport.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    /// No device token yet: pairing is the only thing to do.
    Unpaired,
    /// Paired, and waiting for a folder to change.
    Idle,
    /// Paired, and deliberately not syncing.
    Paused,
    /// The server said the token is revoked or expired. Stopped; needs pairing again.
    Disconnected,
}

/// The status the UI renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentStatus {
    pub state: AgentState,
    /// A sentence for a person, never a code (task `116`: "errors state next steps").
    pub summary: String,
    pub version: String,
}

impl AgentStatus {
    pub fn new(state: AgentState) -> Self {
        let summary = match state {
            AgentState::Unpaired => "Not paired. Pair this Mac from Settings → Devices.",
            AgentState::Idle => "Watching for changes.",
            AgentState::Paused => "Paused. Nothing will sync until you resume.",
            AgentState::Disconnected => {
                "This Mac was disconnected. Pair it again from Settings → Devices."
            }
        };
        Self {
            state,
            summary: summary.to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_says_what_to_do_in_words() {
        for state in [
            AgentState::Unpaired,
            AgentState::Idle,
            AgentState::Paused,
            AgentState::Disconnected,
        ] {
            let status = AgentStatus::new(state);
            assert!(status.summary.ends_with('.'), "{state:?}: {}", status.summary);
            assert!(!status.summary.contains('_'), "{state:?} leaks a code");
        }
    }

    #[test]
    fn serializes_as_the_ui_expects() {
        let json = serde_json::to_value(AgentStatus::new(AgentState::Disconnected)).unwrap();
        assert_eq!(json["state"], "disconnected");
        assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
        // Nothing but these three fields crosses to the UI.
        assert_eq!(json.as_object().unwrap().len(), 3);
    }
}
