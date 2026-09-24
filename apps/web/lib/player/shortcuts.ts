import type { PlayerController } from './store';

/**
 * The player's keyboard shortcuts (task `071`). Documented in the player bar's "Keyboard
 * shortcuts" list, which renders {@link PLAYER_SHORTCUTS} — one source for both.
 */
export const PLAYER_SHORTCUTS = [
  { keys: 'Space or K', action: 'Play or pause' },
  { keys: '← / →', action: 'Back or forward 5 seconds' },
  { keys: 'J / L', action: 'Back or forward 10 seconds' },
  { keys: 'M', action: 'Mute or unmute' },
  { keys: '0', action: 'Back to the start' },
] as const;

/**
 * Whether a key press belongs to whatever has focus rather than to the player: a text field, a
 * contenteditable surface (the lyrics editor is a full-screen typing surface — stealing Space
 * there would be intolerable), or a control that uses the same keys itself (a slider, a menu,
 * a button, which Space activates).
 */
export function belongsToFocus(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const role = target.closest('[role]')?.getAttribute('role');
  if (
    role !== undefined &&
    role !== null &&
    [
      'slider',
      'textbox',
      'combobox',
      'menu',
      'menuitem',
      'listbox',
      'option',
      'radio',
      'tab',
      'spinbutton',
    ].includes(role)
  ) {
    return true;
  }
  // Space and Enter already mean "press" on a button or link.
  return target.closest('button, a[href], summary') !== null;
}

/** Handle one key press. Returns whether the player took it (so the caller prevents default). */
export function handlePlayerKey(event: KeyboardEvent, player: PlayerController): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (belongsToFocus(event.target)) return false;
  const state = player.getState();
  if (state.track === null) return false;
  const position = state.positionSeconds;
  switch (event.key) {
    case ' ':
    case 'k':
    case 'K':
      player.toggle();
      return true;
    case 'ArrowLeft':
      player.seek(position - 5);
      return true;
    case 'ArrowRight':
      player.seek(position + 5);
      return true;
    case 'j':
    case 'J':
      player.seek(position - 10);
      return true;
    case 'l':
    case 'L':
      player.seek(position + 10);
      return true;
    case 'm':
    case 'M':
      player.toggleMute();
      return true;
    case '0':
      player.seek(0);
      return true;
    default:
      return false;
  }
}
