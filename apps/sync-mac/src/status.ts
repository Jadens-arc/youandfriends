import { invoke } from '@tauri-apps/api/core';

/** The agent's status, as `agent_status` returns it (`core/src/status.rs`). */
export interface AgentStatus {
  readonly state: 'unpaired' | 'idle' | 'paused' | 'disconnected';
  readonly summary: string;
  readonly version: string;
}

const STATES = new Set(['unpaired', 'idle', 'paused', 'disconnected']);

/**
 * Ask the Rust side. The answer is checked rather than trusted into the UI: a shape this window
 * does not know is shown as "unavailable", never guessed at.
 */
export async function loadStatus(
  call: (command: string) => Promise<unknown> = (command) => invoke(command),
): Promise<AgentStatus | null> {
  try {
    const value = (await call('agent_status')) as Partial<AgentStatus> | null;
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof value.state === 'string' &&
      STATES.has(value.state) &&
      typeof value.summary === 'string' &&
      typeof value.version === 'string'
    ) {
      return value as AgentStatus;
    }
    return null;
  } catch {
    return null;
  }
}
