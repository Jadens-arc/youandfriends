import type { Editor } from '@tiptap/core';
import type { LyricsDocument } from '@youandfriends/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Awareness } from 'y-protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { handlePlayerKey } from '@/lib/player/shortcuts';
import type { PlayerController } from '@/lib/player/store';

import { LyricsPanel } from '../../lyrics-panel';
import { initials, PresenceList } from '../../presence/presence-list';
import { caretScrollDelta, keyboardInset } from '../keyboard';

const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;

const CHORUS: LyricsDocument = {
  type: 'doc',
  content: [
    {
      type: 'lyricsSection',
      attrs: { kind: 'chorus' },
      content: [{ type: 'lyricsLine', content: [{ type: 'text', text: 'Stay, stay' }] }],
    },
  ],
};

/** A visual viewport the test resizes, as a keyboard opening would. */
function fakeViewport() {
  const target = new EventTarget();
  const viewport = Object.assign(target, { height: 800, offsetTop: 0, width: 390, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  return {
    keyboard(height: number) {
      viewport.height = 800 - height;
      act(() => {
        target.dispatchEvent(new Event('resize'));
      });
    },
  };
}

function phone(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches && query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

function stubLyrics(canEdit: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ version: 2 }))
        : new Response(
            JSON.stringify({
              document: CHORUS,
              version: 1,
              canEdit,
              updatedAt: null,
              yjsState: '',
              collaboration: null,
            }),
          ),
    ),
  );
}

async function mount() {
  render(
    <LyricsPanel
      songId="S1"
      songTitle="Headlights"
      audio={<div data-testid="compact-waveform">waveform</div>}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

/** Focus the writing surface as a tap would. jsdom focuses only elements with a tab index. */
function tapInto() {
  const { element } = surface();
  element.tabIndex = 0;
  act(() => element.focus());
}

function surface() {
  const element = screen.getByRole('textbox', { name: 'Lyrics for Headlights' });
  return { element, editor: (element as unknown as { editor: Editor }).editor };
}

const root = () => document.querySelector('[data-full-screen]');

describe('the keyboard arithmetic', () => {
  it('measures what the keyboard covers from the visual viewport', () => {
    expect(keyboardInset({ height: 800, offsetTop: 0 }, 800)).toBe(0);
    expect(keyboardInset({ height: 460, offsetTop: 0 }, 800)).toBe(340);
    // Safari scrolls the visual viewport down while the keyboard is up.
    expect(keyboardInset({ height: 460, offsetTop: 120 }, 800)).toBe(220);
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 800)).toBe(0);
  });

  it('scrolls the caret up from behind the keyboard, and leaves a visible one alone', () => {
    const visible = { top: 0, bottom: 400 };
    expect(caretScrollDelta({ top: 500, bottom: 520 }, visible)).toBe(144);
    expect(caretScrollDelta({ top: -40, bottom: -20 }, visible)).toBe(-64);
    expect(caretScrollDelta({ top: 200, bottom: 220 }, visible)).toBe(0);
  });
});

describe('writing lyrics on a phone (task 085)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubLyrics(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('goes full screen with the compact waveform above the lyrics, and back', async () => {
    phone(true);
    await mount();
    expect(root()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Write full screen' }));
    const layout = root();
    expect(layout?.className).toMatch(/max-md:fixed/);
    expect(layout?.className).toMatch(/max-md:inset-0/);
    const waveform = screen.getByTestId('compact-waveform');
    // The audio comes before the writing surface, so it stays in view above it.
    expect(
      waveform.compareDocumentPosition(surface().element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(root()).toBeNull();
  });

  it('opens full screen when a phone starts typing, not on a wide screen', async () => {
    phone(false);
    await mount();
    tapInto();
    expect(root()).toBeNull();
    act(() => surface().element.blur());
    vi.unstubAllGlobals();
    stubLyrics(true);
    phone(true);
    tapInto();
    expect(root()).not.toBeNull();
  });

  it('docks the section controls above the keyboard, at thumb size', async () => {
    phone(true);
    const viewport = fakeViewport();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Write full screen' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Section' });
    expect(toolbar).toHaveAttribute('data-docked', 'true');
    expect(toolbar.className).toMatch(/max-md:\[&_button\]:min-h-11/);
    expect(toolbar.className).toMatch(/max-md:\[&_button\]:min-w-11/);
    expect(toolbar.style.bottom).toBe('0px');
    viewport.keyboard(340);
    expect(toolbar.style.bottom).toBe('340px');
    viewport.keyboard(0);
    expect(toolbar.style.bottom).toBe('0px');
  });

  it('scrolls to keep the caret visible as the keyboard opens', async () => {
    phone(true);
    const viewport = fakeViewport();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Write full screen' }));
    const scroller = surface().element.closest('.max-md\\:overflow-y-auto') as HTMLElement;
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as unknown as typeof scroller.scrollBy;
    const { editor } = surface();
    // Where the caret sits on screen: low, where the keyboard is about to be.
    editor.view.coordsAtPos = () => ({ top: 600, bottom: 620, left: 0, right: 0 });
    tapInto();
    viewport.keyboard(340);
    act(() => {
      editor.commands.setTextSelection(2);
    });
    const deltas = scrollBy.mock.calls.map(([options]) => (options as ScrollToOptions).top ?? 0);
    expect(deltas.some((delta) => delta > 0)).toBe(true);
  });

  it('gives viewers and commenters a genuinely read-only view', async () => {
    vi.unstubAllGlobals();
    stubLyrics(false);
    phone(true);
    await mount();
    expect(screen.queryByRole('button', { name: 'Write full screen' })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Section' })).toBeNull();
    expect(surface().element).toHaveAttribute('contenteditable', 'false');
    tapInto();
    expect(root()).toBeNull();
  });

  it('keeps Space for typing: the player shortcut does not fire in the editor', async () => {
    phone(true);
    await mount();
    const toggle = vi.fn();
    // Something is loaded and playing — Space would pause it, anywhere but a text surface.
    const player = {
      toggle,
      getState: () => ({ track: { songId: 'S1' }, positionSeconds: 12 }),
    } as unknown as PlayerController;
    const listener = (event: KeyboardEvent) => handlePlayerKey(event, player);
    document.addEventListener('keydown', listener);
    fireEvent.keyDown(surface().element, { key: ' ', code: 'Space' });
    document.removeEventListener('keydown', listener);
    expect(toggle).not.toHaveBeenCalled();
    // …while the same key on the page body would play.
    const onBody = new KeyboardEvent('keydown', { key: ' ', code: 'Space' });
    Object.defineProperty(onBody, 'target', { value: document.body });
    expect(handlePlayerKey(onBody, player)).toBe(true);
  });
});

describe('presence at phone width', () => {
  it('shows initials as avatars while keeping names for screen readers', () => {
    expect(initials('Sam Rivera')).toBe('SR');
    expect(initials('alex')).toBe('A');
    expect(initials('  Émile   de la Cruz ')).toBe('ÉC');
    const awareness = new Awareness(new Y.Doc());
    const other = new Awareness(new Y.Doc());
    other.setLocalStateField('user', { name: 'Sam Rivera', color: 'var(--color-olive-text)' });
    awareness.states.set(other.clientID, other.getLocalState() ?? {});
    render(<PresenceList awareness={awareness} status="connected" />);
    const item = screen.getByRole('listitem');
    expect(item.querySelector('[data-avatar]')?.textContent).toBe('SR');
    expect(item.querySelector('.max-md\\:sr-only')?.textContent).toBe('Sam Rivera');
  });
});
