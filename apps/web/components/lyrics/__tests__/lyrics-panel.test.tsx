import type { Editor } from '@tiptap/core';
import type { LyricsDocument } from '@youandfriends/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTOSAVE_DEBOUNCE_MS } from '@/lib/lyrics/autosave';

import { LyricsPanel } from '../lyrics-panel';

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch that serves the GET from `reads` in turn and answers every PUT with `put`. */
function stubFetch(
  reads: readonly { document: LyricsDocument; version: number; canEdit: boolean }[],
  put: () => Response,
) {
  let read = 0;
  const calls: { method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    // The song's comments (task `092`) are fetched too; they are not what these tests are about.
    if (String(url).endsWith('/comments'))
      return new Response(JSON.stringify({ threads: [], canComment: true }));
    const method = init?.method ?? 'GET';
    calls.push({ method, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    if (method === 'PUT') return put();
    const next = reads[Math.min(read, reads.length - 1)];
    read += 1;
    return json({ ...next, updatedAt: null, yjsState: '', collaboration: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function mountLoaded(audio: React.ReactNode = null) {
  render(<LyricsPanel songId="S1" songTitle="Headlights" audio={audio} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
}

/** The editing surface, and the Tiptap editor Tiptap hangs on it. */
function surface() {
  const element = screen.getByRole('textbox', { name: 'Lyrics for Headlights' });
  return { element, editor: (element as unknown as { editor: Editor }).editor };
}

function type(words: string) {
  act(() => {
    surface().editor.chain().focus('end').insertContent(words).run();
  });
}

// jsdom has no layout: ProseMirror's scroll-into-view asks ranges for rectangles that do not
// exist. Empty ones are the honest answer from a page that is never drawn.
const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () =>
  ({ ...emptyRect, toJSON: () => emptyRect }) as DOMRect;

describe('LyricsPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('autosaves after a pause and says so in words', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ document: CHORUS, version: 3, canEdit: true }], () =>
      json({ version: 4 }),
    );
    await mountLoaded();
    expect(surface().element).toHaveTextContent('ChorusStay, stay');

    type(' — headlights on');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    const saved = calls.find((call) => call.method === 'PUT');
    expect(saved?.body).toMatchObject({ baseVersion: 3 });
    expect(JSON.stringify(saved?.body)).toContain('Stay, stay — headlights on');
  });

  it('on a conflict overwrites nothing and offers the newer version, keeping the user’s text', async () => {
    vi.useFakeTimers();
    const newer: LyricsDocument = {
      type: 'doc',
      content: [
        {
          type: 'lyricsSection',
          attrs: { kind: 'bridge' },
          content: [{ type: 'lyricsLine', content: [{ type: 'text', text: 'Their line' }] }],
        },
      ],
    };
    stubFetch(
      [
        { document: CHORUS, version: 3, canEdit: true },
        { document: newer, version: 5, canEdit: true },
      ],
      () => json({ error: { code: 'conflict' } }, 409),
    );
    await mountLoaded();
    type(' — my line');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Nothing was overwritten');

    fireEvent.click(screen.getByRole('button', { name: 'Load the newer version' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(surface().element).toHaveTextContent('BridgeTheir line');
    expect(screen.getByLabelText('Your text before loading the newer version')).toHaveValue(
      '[Chorus]\nStay, stay — my line',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('stops sending once access is lost, and says the change was not saved', async () => {
    vi.useFakeTimers();
    stubFetch([{ document: CHORUS, version: 3, canEdit: true }], () => json({}, 404));
    await mountLoaded();
    type(' late');
    act(() => {
      surface().editor.commands.blur();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('were not saved');
    expect(surface().element).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Section' })).toBeNull();
  });

  it('is read-only for someone who may only view', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ document: CHORUS, version: 3, canEdit: false }], () =>
      json({ version: 99 }),
    );
    await mountLoaded();
    expect(surface().element).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Section' })).toBeNull();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('restructures from the section toolbar, which acts on the section with the cursor', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ document: CHORUS, version: 3, canEdit: true }], () =>
      json({ version: 4 }),
    );
    await mountLoaded();
    act(() => {
      surface().editor.commands.focus('start');
    });
    const toolbar = screen.getByRole('toolbar', { name: 'Section' });
    expect(toolbar).toHaveTextContent('In Chorus');

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Chorus' }));
    expect(toolbar).toHaveTextContent('In Chorus 2');
    fireEvent.change(screen.getByLabelText('Type of Chorus 2'), { target: { value: 'outro' } });
    expect(toolbar).toHaveTextContent('In Outro');
    expect(screen.getByRole('button', { name: 'Move Outro down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Outro up' }));

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const name = screen.getByLabelText('Name for Outro');
    fireEvent.change(name, { target: { value: 'Tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(toolbar).toHaveTextContent('In Tag');
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      'Tag',
      'Chorus',
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    const body = calls.find((call) => call.method === 'PUT')?.body as {
      document: LyricsDocument;
    };
    expect(body.document.content.map((section) => section.attrs)).toEqual([
      { kind: 'outro', label: 'Tag', timestampMs: null },
      { kind: 'chorus', label: null, timestampMs: null },
    ]);
  });

  it('puts the audio beside the lyrics', async () => {
    vi.useFakeTimers();
    stubFetch([{ document: CHORUS, version: 3, canEdit: true }], () => json({ version: 4 }));
    await mountLoaded(<p>the player</p>);
    const aside = screen.getByRole('complementary', { name: 'Audio for Headlights' });
    expect(aside).toHaveTextContent('the player');
    expect(aside.parentElement?.className).toMatch(/lg:grid-cols-/);
  });
});
