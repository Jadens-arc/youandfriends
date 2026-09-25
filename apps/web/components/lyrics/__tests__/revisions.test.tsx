import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RETENTION_POLICY_TEXT } from '@/lib/lyrics/revisions-policy';
import { textToLyrics } from '@/lib/lyrics/text-format';

import { HistoryPanel, RevisionDiff } from '../revisions/history-panel';

const NOW_DOC = textToLyrics('[Verse]\nTail lights in the rain\n[Chorus]\nStay');
const OLD_DOC = textToLyrics('[Verse]\nHeadlights on\n[Chorus]\nStay');

const REVISIONS = [
  {
    id: 'R2',
    kind: 'checkpoint',
    name: 'Before the bridge rewrite',
    createdAt: '2026-09-22T10:00:00.000Z',
    author: 'Sam',
  },
  {
    id: 'R1',
    kind: 'automatic',
    name: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    author: 'Alex',
  },
];

function stubFetch() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });
      if (url.endsWith('/restore')) {
        return new Response(
          JSON.stringify({ version: 9, document: OLD_DOC, yjsUpdate: '', beforeRevisionId: 'R3' }),
        );
      }
      if (method === 'POST') return new Response(JSON.stringify({ id: 'R4' }), { status: 201 });
      if (url.endsWith('/revisions')) return new Response(JSON.stringify({ revisions: REVISIONS }));
      return new Response(JSON.stringify({ ...REVISIONS[1], document: OLD_DOC }));
    }),
  );
  return calls;
}

async function openPanel(canEdit = true) {
  const onRestored = vi.fn();
  const beforeCheckpoint = vi.fn(async () => {});
  render(
    <HistoryPanel
      songId="S1"
      canEdit={canEdit}
      current={() => NOW_DOC}
      beforeCheckpoint={beforeCheckpoint}
      onRestored={onRestored}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
  });
  return { onRestored, beforeCheckpoint };
}

describe('lyrics history (task 084)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists drafts with their name, kind, time, and author, and says what is kept', async () => {
    stubFetch();
    await openPanel();
    expect(screen.getByText(RETENTION_POLICY_TEXT)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Earlier drafts' });
    const items = within(list).getAllByRole('button');
    expect(items[0]).toHaveTextContent('Before the bridge rewrite');
    expect(items[0]).toHaveTextContent('Checkpoint');
    expect(items[0]).toHaveTextContent('Sam');
    expect(items[1]).toHaveTextContent('Automatic snapshot');
    expect(items[1]?.querySelector('time')).toHaveAttribute('datetime', '2026-09-20T10:00:00.000Z');
  });

  it('compares a draft with now, line by line, in words as well as marks', async () => {
    stubFetch();
    await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Automatic snapshot/ }));
    });
    const diff = screen.getByRole('list', { name: 'Changes from this draft to now' });
    const rows = within(diff).getAllByRole('listitem');
    const removed = rows.find((row) => row.dataset.change === 'removed');
    const added = rows.find((row) => row.dataset.change === 'added');
    expect(removed).toHaveTextContent('Removed: Headlights on');
    expect(added).toHaveTextContent('Added: Tail lights in the rain');
    expect(rows.find((row) => row.textContent?.includes('[Chorus]'))?.dataset.change).toBe('same');
  });

  it('restores a draft, telling the editor, and saying what was kept', async () => {
    const calls = stubFetch();
    const { onRestored } = await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Automatic snapshot/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore this draft' }));
    });
    expect(calls.some((call) => call.url.endsWith('/R1/restore') && call.method === 'POST')).toBe(
      true,
    );
    expect(onRestored).toHaveBeenCalledWith(
      expect.objectContaining({ version: 9, beforeRevisionId: 'R3' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('What was there before is kept');
  });

  it('saves what is waiting before naming a checkpoint, and needs a name', async () => {
    const calls = stubFetch();
    const { beforeCheckpoint } = await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Give the checkpoint a name.');
    fireEvent.change(screen.getByLabelText(/Name a checkpoint/), {
      target: { value: 'Demo take' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    });
    expect(beforeCheckpoint).toHaveBeenCalledOnce();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ name: 'Demo take' });
    expect(screen.getByRole('status')).toHaveTextContent('Checkpoint “Demo take” saved.');
  });

  it('lets a viewer look but not restore or checkpoint', async () => {
    stubFetch();
    await openPanel(false);
    expect(screen.queryByRole('button', { name: 'Save checkpoint' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Automatic snapshot/ }));
    });
    expect(
      screen.getByRole('list', { name: 'Changes from this draft to now' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this draft' })).toBeNull();
  });

  it('says so when a draft matches now', () => {
    render(<RevisionDiff before={NOW_DOC} after={NOW_DOC} />);
    expect(screen.getByText('Same as the lyrics now.')).toBeInTheDocument();
  });
});
