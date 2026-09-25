import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommentsPanel } from '../comments-panel';

const comment = (overrides: Record<string, unknown>) => ({
  id: 'C1',
  author: 'Sam',
  body: 'The second chorus drags.',
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
        body: '<img src=x onerror=alert(1)> **bold?**',
        canEdit: true,
        canDelete: true,
      }),
      comment({ id: 'C2', author: 'Alex', body: 'Agreed.', editedAt: '2026-09-24T11:00:00.000Z' }),
      comment({ id: 'C3', deleted: true, body: '' }),
    ],
  },
  {
    id: 'T2',
    anchor: { kind: 'general' },
    resolvedAt: '2026-09-23T10:00:00.000Z',
    resolvedBy: 'Alex',
    comments: [comment({ id: 'C4', body: 'Fixed the bridge.' })],
  },
];

function stubFetch(canComment: boolean) {
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
      if (method !== 'GET') return new Response(null, { status: method === 'POST' ? 201 : 204 });
      return new Response(JSON.stringify({ threads: THREADS, canComment }));
    }),
  );
  return calls;
}

async function mount() {
  render(<CommentsPanel songId="S1" />);
  await act(async () => {});
}

describe('CommentsPanel (task 090)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows comments as plain text — markup in a comment stays text', async () => {
    stubFetch(true);
    const { container } = render(<CommentsPanel songId="S1" />);
    await act(async () => {});
    expect(screen.getByText('<img src=x onerror=alert(1)> **bold?**')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong, b')).toBeNull();
  });

  it('marks edits, and keeps a deleted comment’s place in its thread', async () => {
    stubFetch(true);
    await mount();
    const thread = screen.getByRole('article', { name: /^Thread: <img/ });
    expect(within(thread).getByText(/edited/)).toBeInTheDocument();
    const items = within(thread).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent('This comment was deleted.');
  });

  it('folds resolved threads away, and says who resolved them', async () => {
    stubFetch(true);
    await mount();
    const summary = screen.getByText('1 resolved thread');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Resolved by Alex')).toBeInTheDocument();
  });

  it('starts a general thread, replies, and resolves', async () => {
    const calls = stubFetch(true);
    await mount();
    fireEvent.change(screen.getByLabelText('Start a conversation about this song'), {
      target: { value: 'Try it slower?' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      url: '/api/songs/S1/comments',
      body: { anchor: { kind: 'general' }, body: 'Try it slower?' },
    });

    const thread = screen.getByRole('article', { name: /^Thread: <img/ });
    fireEvent.click(within(thread).getByRole('button', { name: 'Reply' }));
    fireEvent.change(within(thread).getByLabelText('Your reply'), { target: { value: 'Yes' } });
    await act(async () => {
      fireEvent.click(within(thread).getByRole('button', { name: 'Reply' }));
    });
    expect(
      calls.some(
        (call) => call.url === '/api/songs/S1/comments/T1/replies' && call.method === 'POST',
      ),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(within(thread).getByRole('button', { name: 'Resolve' }));
    });
    expect(calls.find((call) => call.method === 'PATCH')).toMatchObject({
      url: '/api/songs/S1/comments/T1',
      body: { resolved: true },
    });
  });

  it('refuses an empty comment before sending it', async () => {
    const calls = stubFetch(true);
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Write something first.');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('lets a viewer read, and offers them nothing to post or change', async () => {
    stubFetch(false);
    await mount();
    expect(screen.getByText('Agreed.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Start a conversation about this song')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reply|Resolve|Reopen/ })).toBeNull();
  });
});
