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
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    if (method === 'PUT') return put();
    const next = reads[Math.min(read, reads.length - 1)];
    read += 1;
    return json({ ...next, updatedAt: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function mountLoaded() {
  render(<LyricsPanel songId="S1" songTitle="Headlights" />);
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

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
    const editor = screen.getByLabelText('Lyrics for Headlights');
    expect(editor).toHaveValue('[Chorus]\nStay, stay');

    fireEvent.change(editor, { target: { value: '[Chorus]\nStay, stay\nHeadlights on' } });
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    const saved = calls.find((call) => call.method === 'PUT');
    expect(saved?.body).toMatchObject({ baseVersion: 3 });
    expect(JSON.stringify(saved?.body)).toContain('Headlights on');
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
    const editor = screen.getByLabelText('Lyrics for Headlights');
    fireEvent.change(editor, { target: { value: '[Chorus]\nMy line' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Nothing was overwritten');

    fireEvent.click(screen.getByRole('button', { name: 'Load the newer version' }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(editor).toHaveValue('[Bridge]\nTheir line');
    expect(screen.getByLabelText('Your text before loading the newer version')).toHaveValue(
      '[Chorus]\nMy line',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('stops sending once access is lost, and says the change was not saved', async () => {
    vi.useFakeTimers();
    stubFetch([{ document: CHORUS, version: 3, canEdit: true }], () => json({}, 404));
    await mountLoaded();
    const editor = screen.getByLabelText('Lyrics for Headlights');
    fireEvent.change(editor, { target: { value: '[Chorus]\nlate' } });
    fireEvent.blur(editor);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByRole('status')).toHaveTextContent('were not saved');
    expect(editor).toHaveAttribute('readonly');
  });

  it('is read-only for someone who may only view', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([{ document: CHORUS, version: 3, canEdit: false }], () =>
      json({ version: 99 }),
    );
    await mountLoaded();
    expect(screen.getByLabelText('Lyrics for Headlights')).toHaveAttribute('readonly');
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});
