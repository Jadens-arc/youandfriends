import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationBell } from '../notification-bell';
import { NotificationList, type NotificationView } from '../notification-list';

vi.mock('next/navigation', () => ({ usePathname: () => '/library' }));

const NOW = new Date('2026-10-13T12:00:00Z');

const item = (overrides: Partial<NotificationView>): NotificationView => ({
  id: 'N1',
  event: 'comment.created',
  read: false,
  count: 1,
  summary: 'Sam commented on Headlights',
  targetName: 'Headlights',
  href: '/songs/S1?tab=activity&thread=T1',
  updatedAt: '2026-10-13T11:58:00Z',
  items: [
    {
      actor: 'Sam',
      preview: '<b>loud</b> kick',
      href: '/songs/S1?tab=activity&thread=T1',
      at: '2026-10-13T11:58:00Z',
    },
  ],
  ...overrides,
});

const LIST = [
  item({}),
  item({
    id: 'N2',
    count: 3,
    summary: '3 new comments on Tail Lights',
    href: '/songs/S2?tab=activity&thread=T9',
    items: [
      {
        actor: 'Sol',
        preview: 'Agreed.',
        href: '/songs/S2?tab=activity&thread=T9',
        at: NOW.toISOString(),
      },
      {
        actor: 'Sam',
        preview: 'And the hats.',
        href: '/songs/S2?tab=activity&thread=T8',
        at: NOW.toISOString(),
      },
    ],
  }),
  item({
    id: 'N3',
    read: true,
    summary: 'Avery uploaded a new version of Headlights',
    href: '/songs/S1?version=V2',
  }),
];

function stubFetch({ markStatus = 204, unread = 2 } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
      if (url === '/api/notifications/read') return new Response(null, { status: markStatus });
      if (url === '/api/notifications/unread-count')
        return new Response(JSON.stringify({ unread }));
      return new Response(JSON.stringify({ notifications: LIST, unread: 2 }));
    }),
  );
  return calls;
}

async function mount() {
  render(<NotificationList now={NOW} />);
  await act(async () => {});
}

describe('notification center (task 095)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists grouped notifications with deep links, previews as text, unread said in words', async () => {
    stubFetch();
    const { container } = render(<NotificationList now={NOW} />);
    await act(async () => {});
    const link = screen.getByRole('link', { name: 'Unread: Sam commented on Headlights' });
    expect(link).toHaveAttribute('href', '/songs/S1?tab=activity&thread=T1');
    expect(
      screen.getByRole('link', { name: 'Avery uploaded a new version of Headlights' }),
    ).toHaveAttribute('href', '/songs/S1?version=V2');
    expect(screen.getAllByText('<b>loud</b> kick').length).toBeGreaterThan(0);
    expect(container.querySelector('b')).toBeNull();
  });

  it('expands a group to its newest events, each with its own link', async () => {
    stubFetch();
    await mount();
    const toggle = screen.getByRole('button', { name: 'Show the latest 2 of 3' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    const links = within(list as HTMLElement).getAllByRole('link');
    expect(links.map((anchor) => anchor.getAttribute('href'))).toEqual([
      '/songs/S2?tab=activity&thread=T9',
      '/songs/S2?tab=activity&thread=T8',
    ]);
  });

  it('marks one read at once, and all read in bulk', async () => {
    const calls = stubFetch();
    await mount();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Mark “Sam commented on Headlights” read' }),
      );
    });
    expect(calls.find((call) => call.url === '/api/notifications/read')?.body).toEqual({
      ids: ['N1'],
      read: true,
    });
    expect(screen.getByRole('link', { name: 'Sam commented on Headlights' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unread (1)' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    });
    expect(calls.at(-1)?.body).toEqual({ all: true, read: true });
    expect(screen.getByRole('button', { name: 'Unread (0)' })).toBeInTheDocument();
  });

  it('filters to unread, and puts a change back when the server refuses it', async () => {
    stubFetch({ markStatus: 500 });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Unread (2)' }));
    expect(screen.queryByRole('link', { name: /uploaded a new version/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('That change was not saved.');
    expect(screen.getByRole('button', { name: 'Unread (2)' })).toBeInTheDocument();
  });

  it('shows the unread count in the shell as a number, in the link’s name too', async () => {
    stubFetch({ unread: 4 });
    render(<NotificationBell />);
    await act(async () => {});
    const bell = screen.getByRole('link', { name: 'Notifications, 4 unread' });
    expect(bell).toHaveAttribute('href', '/notifications');
    expect(bell).toHaveTextContent('4');
  });
});
