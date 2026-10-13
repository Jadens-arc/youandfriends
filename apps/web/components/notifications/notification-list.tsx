'use client';

import { Button, cn, focusRing, transition } from '@youandfriends/ui';
import { Check, ChevronDown, Mail, MailOpen } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import * as React from 'react';

import { formatRelative } from '@/lib/library/format';

import { announceNotificationsChanged } from './unread';

/**
 * The notification center (task `095`). Grouped rows — ten comments on one song are one row,
 * expandable to the newest few — each linking to the exact thread, version, or tab. Unread is
 * said in words and weight, not by a colored dot alone. Opening a notification marks it read.
 */

export interface NotificationItemView {
  readonly actor: string | null;
  readonly preview: string | null;
  readonly href: string;
  readonly at: string;
}

export interface NotificationView {
  readonly id: string;
  readonly event: string;
  readonly read: boolean;
  readonly count: number;
  readonly summary: string;
  readonly targetName: string;
  readonly href: string;
  readonly updatedAt: string;
  readonly items: readonly NotificationItemView[];
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'loaded';
      readonly items: readonly NotificationView[];
      readonly unread: number;
    };

async function mark(body: { ids?: string[]; all?: true; read: boolean }): Promise<boolean> {
  try {
    const response = await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchNotifications(): Promise<State> {
  try {
    const response = await fetch('/api/notifications', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as {
      notifications?: NotificationView[];
      unread?: number;
    };
    return {
      kind: 'loaded',
      items: Array.isArray(body.notifications) ? body.notifications : [],
      unread: typeof body.unread === 'number' ? body.unread : 0,
    };
  } catch {
    return { kind: 'error' };
  }
}

export function NotificationList({ now = new Date() }: { readonly now?: Date }) {
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all');
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(() => fetchNotifications().then(setState), []);

  React.useEffect(() => {
    void fetchNotifications().then(setState);
  }, []);

  /** Change read state here at once; put it back if the server says no. */
  const setRead = async (ids: string[] | 'all', read: boolean) => {
    if (state.kind !== 'loaded') return;
    const before = state;
    const touched = (item: NotificationView) => ids === 'all' || ids.includes(item.id);
    const items = state.items.map((item) => (touched(item) ? { ...item, read } : item));
    setState({ ...state, items, unread: items.filter((item) => !item.read).length });
    setFailed(false);
    const ok = await mark(ids === 'all' ? { all: true, read } : { ids, read });
    if (!ok) {
      setState(before);
      setFailed(true);
    }
    announceNotificationsChanged();
  };

  if (state.kind === 'loading') {
    return <p className="text-body text-muted-foreground font-sans">Loading notifications…</p>;
  }
  if (state.kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-body text-muted-foreground font-sans">
          Your notifications could not be loaded.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="max-md:min-h-11"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const shown = filter === 'unread' ? state.items.filter((item) => !item.read) : state.items;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Show" className="border-border flex rounded-md border p-0.5">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'text-caption rounded-sm px-3 py-1 font-sans max-md:min-h-11',
                filter === value
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
                transition,
                focusRing,
              )}
            >
              {value === 'all' ? 'All' : `Unread (${state.unread})`}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="max-md:min-h-11"
          disabled={state.unread === 0}
          onClick={() => void setRead('all', true)}
        >
          <Check aria-hidden />
          Mark all read
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-caption text-destructive font-sans">
          That change was not saved. Try again.
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="text-body text-muted-foreground font-sans italic">
          {filter === 'unread'
            ? 'You are all caught up.'
            : 'Nothing yet. When collaborators comment, upload, or mention you, it will show up here.'}
        </p>
      ) : (
        <ul className="border-border bg-card divide-border-subtle divide-y rounded-md border">
          {shown.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              now={now}
              onOpen={() => (item.read ? undefined : void setRead([item.id], true))}
              onToggle={() => void setRead([item.id], !item.read)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  now,
  onOpen,
  onToggle,
}: {
  readonly item: NotificationView;
  readonly now: Date;
  readonly onOpen: () => void;
  readonly onToggle: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const latest = item.items[0];
  const more = item.items.length > 1;
  const listId = React.useId();
  return (
    <li className={cn('flex flex-col gap-1 px-4 py-3', item.read ? '' : 'bg-background')}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-2 size-2 shrink-0 rounded-full',
            item.read ? 'bg-transparent' : 'bg-primary',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            href={item.href as Route}
            onClick={onOpen}
            className={cn(
              'text-body text-foreground rounded-sm font-sans hover:underline',
              item.read ? '' : 'font-semibold',
              focusRing,
            )}
          >
            {item.read ? null : <span className="sr-only">Unread: </span>}
            {item.summary}
          </Link>
          {latest?.preview == null ? null : (
            <p className="text-caption text-muted-foreground line-clamp-2 font-sans break-words">
              {latest.actor === null || item.count === 1 ? '' : `${latest.actor}: `}
              {latest.preview}
            </p>
          )}
          <p className="text-caption text-muted-foreground font-sans">
            <time dateTime={item.updatedAt}>{formatRelative(new Date(item.updatedAt), now)}</time>
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={item.read ? `Mark “${item.summary}” unread` : `Mark “${item.summary}” read`}
          title={item.read ? 'Mark unread' : 'Mark read'}
          className={cn(
            'text-muted-foreground hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-sm max-md:size-11',
            transition,
            focusRing,
          )}
        >
          {item.read ? (
            <Mail className="size-4" aria-hidden />
          ) : (
            <MailOpen className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {more ? (
        <div className="pl-5">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((open) => !open)}
            className={cn(
              'text-caption text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-sm font-sans max-md:min-h-11',
              focusRing,
            )}
          >
            <ChevronDown
              aria-hidden
              className={cn('size-3.5', transition, expanded ? 'rotate-180' : '')}
            />
            {expanded ? 'Hide' : `Show the latest ${item.items.length}`}
            {item.count > item.items.length ? ` of ${item.count}` : ''}
          </button>
          <ol id={listId} hidden={!expanded} className="mt-1 flex flex-col gap-1">
            {item.items.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <Link
                  href={entry.href as Route}
                  onClick={onOpen}
                  className={cn(
                    'text-caption text-foreground block rounded-sm font-sans hover:underline',
                    focusRing,
                  )}
                >
                  <span className="font-medium">{entry.actor ?? 'Someone'}</span>
                  {entry.preview === null ? '' : `: ${entry.preview}`}
                  <span className="text-muted-foreground">
                    {' · '}
                    <time dateTime={entry.at}>{formatRelative(new Date(entry.at), now)}</time>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}
