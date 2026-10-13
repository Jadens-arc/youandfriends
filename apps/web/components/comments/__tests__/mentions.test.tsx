import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentsPanel } from '../comments-panel';
import { forgetMentionable } from '../mentions/mention-input';
import { activeQuery, segments, toEditable, toStored } from '../mentions/tokens';

const SAM = '01J9ZZZZZZZZZZZZZZZZZZZSAM';
const SOL = '01J9ZZZZZZZZZZZZZZZZZZZS0B';

const PEOPLE = [
  { userId: SAM, displayName: 'Sam Rivera' },
  { userId: SOL, displayName: 'Sol' },
];

function threads(reactions: unknown[] = []) {
  return [
    {
      id: 'T1',
      anchor: { kind: 'general' },
      resolvedAt: null,
      resolvedBy: null,
      comments: [
        {
          id: 'C1',
          author: 'Avery',
          body: `<@${SAM}> the bridge <b>drags</b>`,
          createdAt: '2026-10-13T10:00:00.000Z',
          editedAt: null,
          deleted: false,
          canEdit: false,
          canDelete: false,
          mentions: [{ userId: SAM, displayName: 'Sam Renamed' }],
          reactions,
        },
      ],
    },
    {
      id: 'T2',
      anchor: { kind: 'general' },
      resolvedAt: '2026-10-12T10:00:00.000Z',
      resolvedBy: 'Sol',
      comments: [
        {
          id: 'C2',
          author: 'Sol',
          body: 'Fixed.',
          createdAt: '2026-10-12T09:00:00.000Z',
          editedAt: null,
          deleted: false,
          canEdit: false,
          canDelete: false,
        },
      ],
    },
  ];
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch({
  reactions = [] as unknown[],
  reactStatus = 204,
  postStatus = 201,
  postBody = null as unknown,
} = {}) {
  const calls: Call[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });
      if (url.endsWith('/mentionable')) return new Response(JSON.stringify({ people: PEOPLE }));
      if (url.endsWith('/reactions')) {
        await gate;
        return new Response(null, { status: reactStatus });
      }
      if (method === 'POST') {
        return new Response(postBody === null ? null : JSON.stringify(postBody), {
          status: postStatus,
        });
      }
      return new Response(JSON.stringify({ threads: threads(reactions), canComment: true }));
    }),
  );
  return { calls, release: () => release() };
}

async function mount() {
  render(<CommentsPanel songId="S1" />);
  await act(async () => {});
}

describe('mention tokens (task 094)', () => {
  it('turns picked names into references and back', () => {
    const stored = toStored('@Sam Rivera and @Sol, and @Nobody', PEOPLE);
    expect(stored).toBe(`<@${SAM}> and <@${SOL}>, and @Nobody`);
    expect(toEditable(stored, PEOPLE)).toBe('@Sam Rivera and @Sol, and @Nobody');
    expect(segments(stored).filter((part) => part.kind === 'mention')).toHaveLength(2);
    expect(activeQuery('hey @Sa', 7)).toEqual({ start: 4, query: 'Sa' });
    expect(activeQuery('mail@example', 12)).toBeNull();
  });
});

describe('mentions, reactions, and resolution in the panel (task 094)', () => {
  beforeEach(() => forgetMentionable());
  afterEach(() => vi.unstubAllGlobals());

  it('shows a mention by the person’s current name, and the rest as text', async () => {
    stubFetch();
    const { container } = render(<CommentsPanel songId="S1" />);
    await act(async () => {});
    expect(screen.getByText('@Sam Renamed')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByText(new RegExp(SAM))).toBeNull();
  });

  it('autocompletes from the server’s list and posts a structured reference', async () => {
    const { calls } = stubFetch();
    await mount();
    const box = screen.getByRole('combobox', { name: 'Start a conversation about this song' });
    expect(calls.some((call) => call.url === '/api/songs/S1/mentionable')).toBe(true);
    fireEvent.change(box, { target: { value: 'hey @sa', selectionStart: 7 } });
    const list = screen.getByRole('listbox', { name: 'People who can open this song' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Sam Rivera']);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveValue('hey @Sam Rivera ');
    fireEvent.change(box, { target: { value: 'hey @Sam Rivera listen', selectionStart: 22 } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    const posted = calls.find((call) => call.method === 'POST');
    expect(posted?.body).toEqual({ anchor: { kind: 'general' }, body: `hey <@${SAM}> listen` });
  });

  it('warns when nobody by that name can open the song', async () => {
    stubFetch();
    await mount();
    const box = screen.getByRole('combobox', { name: 'Start a conversation about this song' });
    fireEvent.change(box, { target: { value: '@zed', selectionStart: 4 } });
    expect(
      screen.getByText('Nobody by that name can open this song. A mention does not share it.'),
    ).toBeInTheDocument();
  });

  it('shows the server’s reason when a mention is refused', async () => {
    stubFetch({
      postStatus: 422,
      postBody: {
        code: 'validation_failed',
        message: 'x',
        fields: [{ path: 'body', message: 'Someone you mentioned cannot open this song.' }],
      },
    });
    await mount();
    const box = screen.getByRole('combobox', { name: 'Start a conversation about this song' });
    fireEvent.change(box, { target: { value: 'hi', selectionStart: 2 } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Someone you mentioned cannot open this song.',
    );
  });

  it('updates a reaction instantly, before the server answers', async () => {
    const { calls, release } = stubFetch({
      reactions: [{ emoji: '🔥', count: 1, mine: false, by: ['Sol'] }],
    });
    await mount();
    const fire = screen.getByRole('button', { name: /^fire, 1: Sol\. Add your reaction/ });
    expect(fire).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      fireEvent.click(fire);
    });
    // The server has not answered yet; the count already says 2, and it is pressed.
    expect(screen.getByRole('button', { name: /^fire, 2: Sol, You/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(calls.find((call) => call.url.endsWith('/reactions'))?.body).toEqual({
      emoji: '🔥',
      on: true,
    });
    await act(async () => release());
  });

  it('rolls a reaction back when the server refuses it', async () => {
    const { release } = stubFetch({ reactStatus: 404 });
    await mount();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Add a reaction' })[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'thumbs up' }));
    });
    expect(screen.getByRole('button', { name: /^thumbs up, 1/ })).toBeInTheDocument();
    await act(async () => release());
    expect(screen.queryByRole('button', { name: /^thumbs up, 1/ })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('That reaction was not saved.');
  });

  it('says who resolved a thread and when, and filters to unresolved threads', async () => {
    stubFetch();
    await mount();
    expect(screen.getByText(/Resolved by Sol/)).toBeInTheDocument();
    const filter = screen.getByRole('button', { name: 'Show unresolved only' });
    fireEvent.click(filter);
    expect(screen.getByRole('button', { name: 'Showing unresolved only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText(/1 resolved thread/)).toBeNull();
    expect(screen.queryByText(/Resolved by Sol/)).toBeNull();
  });
});
