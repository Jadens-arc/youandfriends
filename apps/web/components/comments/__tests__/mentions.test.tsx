import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommentsPanel } from '../comments-panel';
import { clearMentionable } from '../mentions/use-mentionable';

const id = (tag: string) => `01HZX${tag}`.padEnd(26, '0');
const ME = id('ME');
const SAM = id('SAM');
const AXEL = id('AXEL');
const GHOST = id('GHST');

const comment = (overrides: Record<string, unknown>) => ({
  id: 'C1',
  authorId: AXEL,
  author: 'Axel',
  body: 'Hello',
  mentions: [],
  reactions: [],
  createdAt: '2026-09-24T10:00:00.000Z',
  editedAt: null,
  deleted: false,
  canEdit: false,
  canDelete: false,
  ...overrides,
});

const THREADS = [
  {
    id: 'T1',
    anchor: { kind: 'general' },
    resolvedAt: null,
    resolvedBy: null,
    comments: [
      comment({
        id: 'C1',
        body: `<@${SAM}> the bridge? cc <@${GHOST}>`,
        mentions: [{ id: SAM, name: 'Samantha' }],
        reactions: [{ reaction: 'heart', count: 2, mine: false, people: ['Samantha', 'Axel'] }],
      }),
    ],
  },
  {
    id: 'T2',
    anchor: { kind: 'general' },
    resolvedAt: null,
    resolvedBy: null,
    comments: [comment({ id: 'C2', authorId: ME, author: 'Me', body: 'Tempo is fine.' })],
  },
  {
    id: 'T3',
    anchor: { kind: 'general' },
    resolvedAt: '2026-09-23T10:00:00.000Z',
    resolvedBy: 'Axel',
    comments: [comment({ id: 'C3', body: 'Settled.' })],
  },
];

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/** The server, by route. `react` decides how a reaction request is answered. */
function server({
  canComment = true,
  people = [
    { id: SAM, name: 'Samantha' },
    { id: AXEL, name: 'Axel' },
  ],
  unreached = [] as string[],
  react = () => Promise.resolve(new Response(null, { status: 204 })),
} = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      });
      if (url.endsWith('/mentionable')) return new Response(JSON.stringify({ people, you: ME }));
      if (url.endsWith('/reactions')) return react();
      if (method !== 'GET') {
        return new Response(
          JSON.stringify({ threadId: 'T9', commentId: 'C9', unreachedMentions: unreached }),
          {
            status: 201,
          },
        );
      }
      return new Response(JSON.stringify({ threads: THREADS, canComment }));
    }),
  );
  return calls;
}

let song = 0;
async function mount() {
  song += 1;
  render(<CommentsPanel songId={`S-mentions-${song}`} />);
  await act(async () => {});
}

const composer = () => screen.getByLabelText('Start a conversation about this song');

async function typeInto(field: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(field, { target: { value, selectionStart: value.length } });
  });
}

beforeEach(() => clearMentionable());
afterEach(() => vi.unstubAllGlobals());

describe('mentioning someone (task 094)', () => {
  it('suggests people who can see the song, picks by keyboard, and sends a reference', async () => {
    const calls = server();
    await mount();
    await typeInto(composer(), 'What do you think @sa');
    const list = screen.getByRole('listbox', { name: 'People who can see this song' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Samantha']);
    expect(calls.some((call) => call.url === `/api/songs/S-mentions-${song}/mentionable`)).toBe(
      true,
    );
    expect(composer()).toHaveAttribute('aria-activedescendant', expect.stringContaining(SAM));
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(composer()).toHaveValue('What do you think @Samantha ');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    const posted = calls.find((call) => call.method === 'POST')?.body as { body: string };
    // The name is gone from the wire; only the reference is sent.
    expect(posted.body.trim()).toBe(`What do you think <@${SAM}>`);
  });

  it('moves through suggestions with the arrows, and Escape closes them', async () => {
    server();
    await mount();
    await typeInto(composer(), '@');
    const options = () => screen.getAllByRole('option');
    expect(options()).toHaveLength(2);
    fireEvent.keyDown(composer(), { key: 'ArrowDown' });
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(composer(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('says so when no one who can see the song matches — it offers no one else', async () => {
    server();
    await mount();
    await typeInto(composer(), '@oscar');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('No one who can see this song matches “oscar”.')).toBeInTheDocument();
  });

  it('warns before posting a mention of someone who cannot see the song, and posts only when told', async () => {
    const calls = server();
    await mount();
    await typeInto(composer(), `Ask <@${GHOST}> maybe`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'someone can’t see this song, so they won’t be notified. Mentioning someone doesn’t share the song with them.',
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Post anyway' }));
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('does not warn about mentioning yourself', async () => {
    const calls = server();
    await mount();
    await typeInto(composer(), `Note to <@${ME}>`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('tells the author when the server found someone it could not reach after all', async () => {
    server({ unreached: [SAM] });
    await mount();
    await typeInto(composer(), '@sam');
    fireEvent.keyDown(composer(), { key: 'Enter' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(screen.getByRole('status', { name: '' })).toBeDefined();
    expect(
      screen.getByText(/^Samantha can’t see this song, so they won’t be notified/),
    ).toBeInTheDocument();
  });

  it('shows a mention by the current name, hides who an unreached one was, and filters by person', async () => {
    server();
    await mount();
    const mention = screen.getByRole('button', {
      name: '@Samantha — show the conversation with Samantha',
    });
    expect(screen.getByText('@someone')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(GHOST);
    // Two open threads, and one resolved, folded away.
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(mention);
    expect(screen.getByText('Threads with Samantha')).toBeInTheDocument();
    expect(
      screen.getAllByRole('article').map((thread) => thread.getAttribute('aria-label')),
    ).toEqual(['Thread: @Samantha the bridge? cc @someone']);
    fireEvent.click(screen.getByRole('button', { name: 'Show everyone’s' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('filters to unresolved threads', async () => {
    server();
    await mount();
    expect(screen.getByText('1 resolved thread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unresolved' }));
    expect(screen.getByRole('button', { name: 'Unresolved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('1 resolved thread')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('article', { name: 'Thread: Settled.' })).toBeNull();
  });
});

describe('reacting (task 094)', () => {
  const heartIn = (thread: string) =>
    within(screen.getByRole('article', { name: thread })).getByRole('button', {
      name: /^heart: /,
    });

  it('names each reaction, its count, and who — and shows yours at once, before the server answers', async () => {
    let answer: (response: Response) => void = () => {};
    server({ react: () => new Promise<Response>((resolve) => (answer = resolve)) });
    await mount();
    const thread = 'Thread: @Samantha the bridge? cc @someone';
    expect(heartIn(thread)).toHaveAccessibleName('heart: 2 — Samantha, Axel. Add your heart.');
    expect(heartIn(thread)).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      fireEvent.click(heartIn(thread));
    });
    // Not answered yet: already counted, already pressed.
    expect(heartIn(thread)).toHaveAttribute('aria-pressed', 'true');
    expect(heartIn(thread)).toHaveTextContent('3');
    await act(async () => {
      answer(new Response(null, { status: 204 }));
    });
  });

  it('rolls back and says so when a reaction does not save', async () => {
    server({ react: () => Promise.resolve(new Response(null, { status: 500 })) });
    await mount();
    const thread = 'Thread: Tempo is fine.';
    const article = screen.getByRole('article', { name: thread });
    fireEvent.click(within(article).getByRole('button', { name: 'Add a reaction' }));
    await act(async () => {
      fireEvent.click(within(article).getByRole('button', { name: 'React with fire' }));
    });
    expect(within(article).queryByRole('button', { name: /^fire: / })).toBeNull();
    expect(within(article).getByRole('alert')).toHaveTextContent('Your reaction didn’t save.');
  });

  it('shows reactions to viewers, and offers them no way to react', async () => {
    server({ canComment: false });
    await mount();
    expect(screen.queryByRole('button', { name: 'Add a reaction' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^heart: / })).toBeNull();
    expect(screen.getByLabelText('heart: 2 — Samantha, Axel')).toBeInTheDocument();
  });
});
