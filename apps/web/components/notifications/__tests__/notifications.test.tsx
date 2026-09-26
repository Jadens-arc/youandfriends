import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentDelay, refreshUnread, resetUnread } from '@/lib/notifications/client';

import { NotificationBell } from '../notification-bell';
import { NotificationList } from '../notification-list';

const item = (id: string, summary: string, unread: boolean, href: string | null = '/songs/S1') => ({
  id,
  summary,
  preview: null,
  href,
  unread,
  at: '2026-09-25T10:00:00.000Z',
});

const GROUPS = [
  {
    key: 'conversation:song:S1',
    summary: 'Sam and Alex left 3 comments on Headlights',
    preview: 'The bridge drags.',
    href: '/songs/S1?tab=activity#comment-C3',
    unread: true,
    count: 3,
    latestAt: '2026-09-25T10:00:00.000Z',
    items: [
      item('N3', 'Alex commented on Headlights', true),
      item('N2', 'Sam commented on Headlights', true),
      item('N1', 'Sam commented on Headlights', false),
    ],
  },
  {
    key: 'invitation:I1',
    summary: 'Owen invited you to Night Drive Studio',
    preview: 'Open the link in your invitation to accept it.',
    href: null,
    unread: false,
    count: 1,
    latestAt: '2026-09-24T10:00:00.000Z',
    items: [item('N0', 'Owen invited you to Night Drive Studio', false, null)],
  },
];

function server(unread = 1) {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ marked: 1 }));
      }
      return new Response(JSON.stringify({ groups: GROUPS, unread }));
    }),
  );
  return posts;
}

beforeEach(() => resetUnread());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the bell (task 095)', () => {
  it('says how many are unread in its name, not only in the badge', async () => {
    server(3);
    render(<NotificationBell />);
    await act(async () => {});
    const bell = screen.getByRole('link', { name: 'Notifications, 3 unread' });
    expect(bell).toHaveAttribute('href', '/notifications');
    expect(bell.querySelector('[data-unread]')?.textContent).toBe('3');
  });

  it('shows no badge when nothing is unread', async () => {
    server(0);
    render(<NotificationBell />);
    await act(async () => {});
    const bell = screen.getByRole('link', { name: 'Notifications' });
    expect(bell.querySelector('[data-unread]')).toBeNull();
  });

  it('backs off while the server is failing, and recovers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await refreshUnread();
    expect(currentDelay()).toBe(120_000);
    await refreshUnread();
    await refreshUnread();
    expect(currentDelay()).toBe(480_000);
    for (let index = 0; index < 5; index += 1) await refreshUnread();
    expect(currentDelay()).toBe(15 * 60_000);
    server(2);
    await refreshUnread();
    expect(currentDelay()).toBe(60_000);
  });
});

describe('the notification list (task 095)', () => {
  async function mount() {
    render(<NotificationList />);
    await act(async () => {});
  }

  it('groups related ones, says unread in words, and links exactly', async () => {
    server();
    await mount();
    const link = screen.getByRole('link', { name: /Sam and Alex left 3 comments on Headlights/ });
    expect(link).toHaveAttribute('href', '/songs/S1?tab=activity#comment-C3');
    expect(within(link).getByText('Unread:')).toHaveClass('sr-only');
    // An invitation carries no way in: it says so, and is not a link.
    expect(screen.getByText('Owen invited you to Night Drive Studio')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /invited you/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 3' }));
    expect(screen.getAllByRole('link', { name: /commented on Headlights/ })).toHaveLength(3);
  });

  it('marks one entry read, or all of them', async () => {
    const posts = server();
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    });
    expect(posts[0]).toEqual({ ids: ['N3', 'N2'] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    });
    expect(posts[1]).toEqual({ all: true });
  });

  it('marks an entry read as it is opened', async () => {
    const posts = server();
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: /Sam and Alex left 3 comments/ }));
    });
    expect(posts[0]).toEqual({ ids: ['N3', 'N2'] });
  });

  it('filters to unread', async () => {
    server();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Unread (1)' }));
    expect(screen.queryByText('Owen invited you to Night Drive Studio')).toBeNull();
    expect(screen.getByRole('link', { name: /left 3 comments/ })).toBeInTheDocument();
  });
});

describe('landing on a comment from a notification (task 095)', () => {
  it('opens a resolved thread, scrolls to the comment, and moves focus there', async () => {
    const { CommentsPanel } = await import('@/components/comments/comments-panel');
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              canComment: false,
              threads: [
                {
                  id: 'T1',
                  anchor: { kind: 'general' },
                  resolvedAt: '2026-09-23T10:00:00.000Z',
                  resolvedBy: 'Alex',
                  comments: [
                    {
                      id: 'C7',
                      author: 'Sam',
                      body: 'This one',
                      createdAt: '2026-09-22T10:00:00.000Z',
                      editedAt: null,
                      deleted: false,
                      canEdit: false,
                      canDelete: false,
                    },
                  ],
                },
              ],
            }),
          ),
      ),
    );
    window.location.hash = '#comment-C7';
    render(<CommentsPanel songId="S-landing" />);
    await act(async () => {});
    expect(scrolled).toEqual(['comment-C7']);
    expect(document.activeElement?.id).toBe('comment-C7');
    expect(document.querySelector('details')?.open).toBe(true);
    window.location.hash = '';
  });
});
