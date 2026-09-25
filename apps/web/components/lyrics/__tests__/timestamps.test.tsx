import { Editor } from '@tiptap/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lyricsToText, textToLyrics } from '@/lib/lyrics/text-format';

const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;

/** The one player, as a fake whose playhead and loaded song the test sets. */
const player = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const fake = {
    state: {
      track: null as null | { songId: string },
      status: 'idle' as string,
      positionSeconds: 0,
    },
    time: 0,
    seek: vi.fn(),
    play: vi.fn(),
    load: vi.fn(async (_track: unknown, _options: unknown) => {}),
    emit() {
      for (const listener of listeners) listener();
    },
    controller: {
      getState: () => fake.state,
      currentTime: () => fake.time,
      seek: (s: number) => fake.seek(s),
      play: () => fake.play(),
      load: (track: unknown, options: unknown) => fake.load(track, options),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return fake;
});
vi.mock('@/lib/player/store', () => ({
  getPlayer: () => player.controller,
  usePlayerState: () => player.state,
}));

const { lyricsExtensions, fromEditorContent, toEditorContent } = await import('../editor/schema');
const { LyricsTimestamps, anchorsOf, currentLineAt, NOT_LOADED_MESSAGE, timestampStorage } =
  await import('../timestamps/extension');
const { LyricsEditor } = await import('../editor/lyrics-editor');

const SONG = 'S1';
const TRACK = {
  versionId: 'V1',
  songId: SONG,
  title: 'Headlights',
  artist: null,
  versionLabel: 'Version 1',
  cover: null,
  album: null,
};
const SHEET = '[Verse]\nfirst line\nsecond line\n[Chorus]\nStay, stay';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  player.seek.mockReset();
  player.play.mockReset();
  player.load.mockReset();
});
beforeEach(() => {
  player.state = { track: null, status: 'idle', positionSeconds: 0 };
  player.time = 0;
});

function open(text = SHEET, refused = vi.fn()) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...lyricsExtensions, LyricsTimestamps.configure({ onRefused: refused })],
    content: toEditorContent(textToLyrics(text)),
  });
  timestampStorage(editor).setTiming({ songId: SONG, track: TRACK });
  editors.push(editor);
  return { editor, refused };
}

/** Put the cursor at the end of the line containing `text`. */
function cursorOn(editor: Editor, text: string) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'lyricsLine' && node.textContent === text) {
      found = pos + 1 + node.content.size;
    }
  });
  if (found === -1) throw new Error(`no line "${text}"`);
  editor.commands.setTextSelection(found);
}

/** Every line's text and timestamp, as it would be saved. */
function timings(editor: Editor): [string, number | null][] {
  return fromEditorContent(editor.getJSON()).content.flatMap((section) =>
    section.content.map((line): [string, number | null] => [
      (line.content ?? []).map((node) => node.text).join(''),
      line.attrs?.timestampMs ?? null,
    ]),
  );
}

const loaded = (seconds: number) => {
  player.state = { track: { songId: SONG }, status: 'playing', positionSeconds: seconds };
  player.time = seconds;
};

describe('lyric timestamps (task 083)', () => {
  it('stamps a line from the playhead in one action, and shows it as a monospace clock', () => {
    const { editor } = open();
    loaded(42.5);
    cursorOn(editor, 'second line');
    expect(editor.commands.stampLine()).toBe(true);
    expect(timings(editor)).toContainEqual(['second line', 42_500]);
    const button = editor.view.dom.querySelector<HTMLButtonElement>('button.lyrics-timestamp');
    expect(button?.textContent).toBe('0:42');
    expect(button?.className).toContain('tabular');
    expect(button?.getAttribute('aria-label')).toBe('Play this line from 0:42');
  });

  it('refuses to stamp from another song’s playhead, and says why', () => {
    const { editor, refused } = open();
    player.state = { track: { songId: 'OTHER' }, status: 'playing', positionSeconds: 10 };
    player.time = 10;
    cursorOn(editor, 'first line');
    expect(editor.commands.stampLine()).toBe(false);
    expect(refused).toHaveBeenCalledWith(NOT_LOADED_MESSAGE);
    expect(timings(editor).every(([, ms]) => ms === null)).toBe(true);
  });

  it('keeps each timestamp on its own line through edits all around it', () => {
    const { editor } = open();
    loaded(30);
    cursorOn(editor, 'second line');
    editor.commands.stampLine();
    loaded(75);
    cursorOn(editor, 'Stay, stay');
    editor.commands.stampSection();

    // Type above it, add lines above it, retype the line itself, and move its section.
    cursorOn(editor, 'first line');
    editor.commands.insertContent(' — longer now');
    editor.commands.splitBlock();
    editor.commands.insertContent('a new line above');
    cursorOn(editor, 'second line');
    editor.commands.insertContent(', revised');
    // Splitting the stamped line leaves the stamp where it was, not on the new line.
    editor.commands.splitBlock();
    editor.commands.insertContent('its continuation');
    cursorOn(editor, 'Stay, stay');
    editor.commands.moveSection(-1);

    expect(timings(editor)).toEqual([
      ['Stay, stay', null],
      ['first line — longer now', null],
      ['a new line above', null],
      ['second line, revised', 30_000],
      ['its continuation', null],
    ]);
    const saved = fromEditorContent(editor.getJSON());
    expect(saved.content[0]?.attrs).toMatchObject({ kind: 'chorus', timestampMs: 75_000 });
    expect(lyricsToText(saved)).toContain('second line, revised');
  });

  it('plays from a line’s time: seeking the loaded song, or loading it there', () => {
    const { editor } = open();
    loaded(0);
    cursorOn(editor, 'second line');
    editor.commands.setLineTimestamp(61_000);
    const button = editor.view.dom.querySelector<HTMLButtonElement>('button.lyrics-timestamp');
    button?.click();
    expect(player.seek).toHaveBeenCalledWith(61);
    expect(player.play).toHaveBeenCalled();

    player.state = { track: null, status: 'idle', positionSeconds: 0 };
    button?.click();
    expect(player.load).toHaveBeenCalledWith(TRACK, { autoplay: true, startAt: 61 });
  });

  it('shows a section’s time beside its heading, and plays from it', () => {
    const { editor } = open();
    cursorOn(editor, 'Stay, stay');
    editor.commands.setSectionTimestamp(90_000);
    const heading = Array.from(editor.view.dom.querySelectorAll('.lyrics-section-heading')).at(-1);
    const button = heading?.querySelector<HTMLButtonElement>('button.lyrics-timestamp');
    expect(button?.getAttribute('aria-label')).toBe('Play Chorus from 1:30');
    button?.click();
    expect(player.load).toHaveBeenCalledWith(TRACK, { autoplay: true, startAt: 90 });
  });

  it('finds the line playing now by time, not by order', () => {
    const { editor } = open();
    cursorOn(editor, 'first line');
    editor.commands.setLineTimestamp(10_000);
    cursorOn(editor, 'second line');
    editor.commands.setLineTimestamp(40_000);
    cursorOn(editor, 'Stay, stay');
    // A chorus stamped earlier than the line above it, as a repeated chorus can be.
    editor.commands.setSectionTimestamp(25_000);
    const anchors = anchorsOf(editor.state.doc);
    const text = (pos: number | null) =>
      pos === null ? null : editor.state.doc.nodeAt(pos)?.textContent;
    expect(text(currentLineAt(anchors, 5_000))).toBeNull();
    expect(text(currentLineAt(anchors, 12_000))).toBe('first line');
    expect(text(currentLineAt(anchors, 30_000))).toBe('Stay, stay');
    expect(text(currentLineAt(anchors, 45_000))).toBe('second line');
  });
});

describe('follow-along (task 083)', () => {
  const DOC = (() => {
    const doc = textToLyrics(SHEET);
    const [verse, chorus] = doc.content;
    return {
      ...doc,
      content: [
        {
          ...verse!,
          content: [
            { ...verse!.content[0]!, attrs: { timestampMs: 5_000 } },
            { ...verse!.content[1]!, attrs: { timestampMs: 20_000 } },
          ],
        },
        chorus!,
      ],
    };
  })();

  let scrolls: ScrollIntoViewOptions[];
  let reducedMotion = false;
  beforeEach(() => {
    scrolls = [];
    Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
      scrolls.push(options as ScrollIntoViewOptions);
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('reduce') && reducedMotion,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    reducedMotion = false;
  });

  function mount() {
    render(
      <LyricsEditor
        document={DOC}
        editable={false}
        label="Lyrics for Headlights"
        onChange={() => {}}
        timing={{ songId: SONG, track: TRACK }}
      />,
    );
  }

  const current = () =>
    screen
      .getByRole('textbox', { name: 'Lyrics for Headlights' })
      .querySelector('[aria-current="true"]')?.textContent;

  function playAt(seconds: number) {
    act(() => {
      loaded(seconds);
      player.emit();
    });
  }

  it('marks the playing line and brings it into view', () => {
    mount();
    playAt(6);
    expect(current()).toContain('first line');
    playAt(21);
    expect(current()).toContain('second line');
    expect(scrolls.at(-1)).toMatchObject({ block: 'center', behavior: 'smooth' });
  });

  it('stops scrolling for a while once the person scrolls away themselves', () => {
    mount();
    playAt(6);
    const before = scrolls.length;
    fireEvent.wheel(window);
    playAt(21);
    expect(current()).toContain('second line');
    expect(scrolls).toHaveLength(before);
  });

  it('does not animate the scroll under reduced motion', () => {
    reducedMotion = true;
    mount();
    playAt(21);
    expect(scrolls.at(-1)).toMatchObject({ behavior: 'auto' });
  });

  it('marks nothing while another song plays', () => {
    mount();
    act(() => {
      player.state = { track: { songId: 'OTHER' }, status: 'playing', positionSeconds: 21 };
      player.emit();
    });
    expect(current()).toBeUndefined();
  });
});
