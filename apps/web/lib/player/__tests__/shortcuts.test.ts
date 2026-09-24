import { afterEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATE, type PlayerState } from '../machine';
import { belongsToFocus, handlePlayerKey } from '../shortcuts';
import type { PlayerController } from '../store';

function controller(state: Partial<PlayerState> = {}) {
  const full: PlayerState = {
    ...INITIAL_STATE,
    track: { versionId: 'V1', songId: 'S1', title: 'T', artist: null, versionLabel: 'Version 1' },
    positionSeconds: 60,
    ...state,
  };
  return {
    getState: () => full,
    toggle: vi.fn(),
    seek: vi.fn(),
    toggleMute: vi.fn(),
    setLoopIn: vi.fn(),
    setLoopOut: vi.fn(),
    clearLoopRegion: vi.fn(),
  } as unknown as PlayerController & {
    setLoopIn: ReturnType<typeof vi.fn>;
    setLoopOut: ReturnType<typeof vi.fn>;
    clearLoopRegion: ReturnType<typeof vi.fn>;
    toggle: ReturnType<typeof vi.fn>;
    seek: ReturnType<typeof vi.fn>;
    toggleMute: ReturnType<typeof vi.fn>;
  };
}

function press(key: string, target: Element = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('player keyboard shortcuts (task 071)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('plays and pauses with Space or K, seeks with the arrows and J/L, mutes with M', () => {
    const player = controller();
    expect(handlePlayerKey(press(' '), player)).toBe(true);
    expect(handlePlayerKey(press('k'), player)).toBe(true);
    expect(player.toggle).toHaveBeenCalledTimes(2);
    handlePlayerKey(press('ArrowRight'), player);
    handlePlayerKey(press('ArrowLeft'), player);
    handlePlayerKey(press('l'), player);
    handlePlayerKey(press('j'), player);
    handlePlayerKey(press('0'), player);
    expect(player.seek.mock.calls.map(([seconds]) => seconds)).toEqual([65, 55, 70, 50, 0]);
    handlePlayerKey(press('m'), player);
    expect(player.toggleMute).toHaveBeenCalledTimes(1);
    // Loop in, out, and clear (task `074`).
    handlePlayerKey(press('i'), player);
    handlePlayerKey(press('o'), player);
    handlePlayerKey(press('u'), player);
    expect(player.setLoopIn).toHaveBeenCalledTimes(1);
    expect(player.setLoopOut).toHaveBeenCalledTimes(1);
    expect(player.clearLoopRegion).toHaveBeenCalledTimes(1);
  });

  it('never takes Space from a field, the lyrics editor, a slider, or a button', () => {
    document.body.innerHTML = `
      <input id="field" />
      <textarea id="area"></textarea>
      <div contenteditable="true"><p id="lyrics">Verse</p></div>
      <div role="slider" id="slider"></div>
      <button id="button">Go</button>`;
    const player = controller();
    for (const id of ['field', 'area', 'lyrics', 'slider', 'button']) {
      const target = document.getElementById(id) as Element;
      expect(belongsToFocus(target)).toBe(true);
      expect(handlePlayerKey(press(' ', target), player)).toBe(false);
    }
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it('leaves chords to the browser and does nothing with no track', () => {
    const player = controller();
    expect(handlePlayerKey(press(' ', document.body, { metaKey: true }), player)).toBe(false);
    expect(handlePlayerKey(press('l', document.body, { ctrlKey: true }), player)).toBe(false);
    expect(handlePlayerKey(press(' '), controller({ track: null }))).toBe(false);
    expect(handlePlayerKey(press('x'), player)).toBe(false);
  });
});
