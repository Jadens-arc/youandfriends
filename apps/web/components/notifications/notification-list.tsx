'use client';

import { Button, cn, focusRing } from '@youandfriends/ui';
import type { Route } from 'next';
import Link from 'next/link';
import * as React from 'react';

import { setUnread } from '@/lib/notifications/client';

/**
 * The notification center's list (task `095`): grouped, newest first, with All / Unread, "Mark
 * all read", and per-entry "Mark read". Unread is said in words, not only with a dot. Opening an
 * entry marks it read and goes exactly where it is about.
 */

interface Item {
  readonly id: string;
  readonly summary: string;
  readonly preview: string | null;
  readonly href: string | null;
  readonly unread: boolean;
  readonly at: string;
}

interface Group {
  readonly key: string;
  readonly summary: string;
  readonly preview: string | null;
  readonly href: string | null;
  readonly unread: boolean;
  readonly count: number;
  readonly latestAt: string;
  readonly items: readonly Item[];
}

type Loaded = { readonly groups: readonly Group[]; readonly unread: number };

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function markRead(body: { ids: readonly string[] } | { all: true }): Promise<boolean> {
  const response = await fetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.ok;
}

function Entry({
  href,
  summary,
  preview,
  unread,
  at,
  onOpen,
}: {
  readonly href: string | null;
  readonly summary: string;
  readonly preview: string | null;
  readonly unread: boolean;
  readonly at: string;
  readonly onOpen: () => void;
}) {
  const text = (
    <>
      <span className="text-body text-foreground">
        {unread ? <span className="sr-only">Unread: </span> : null}
        {summary}
      </span>
      {preview === null ? null : (
        <span className="text-caption text-muted-foreground line-clamp-2">{preview}</span>
      )}
      <time dateTime={at} className="text-caption text-muted-foreground">
        {when.format(new Date(at))}
      </time>
    </>
  );
  return href === null ? (
    <div className="flex flex-col gap-0.5">{text}</div>
  ) : (
    <Link
      href={href as Route}
      onClick={onOpen}
      className={cn('touch-height flex flex-col gap-0.5 rounded-sm', focusRing)}
    >
      {text}
    </Link>
  );
}

export function NotificationList() {
  const [loaded, setLoaded] = React.useState<Loaded | 'loading' | 'error'>('loading');
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const body = response.ok ? ((await response.json()) as Partial<Loaded>) : null;
      if (body === null || !Array.isArray(body.groups) || typeof body.unread !== 'number') {
        setLoaded('error');
        return;
      }
      setLoaded(body as Loaded);
      setUnread(body.unread);
    } catch {
      setLoaded('error');
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function read(body: { ids: readonly string[] } | { all: true }) {
    setError(null);
    if (await markRead(body)) await load();
    else setError('That didn’t save. Try again.');
  }

  if (loaded === 'loading') {
    return <p className="text-body text-muted-foreground font-sans">Loading notifications…</p>;
  }
  if (loaded === 'error') {
    return (
      <p className="text-body text-muted-foreground font-sans">Notifications couldn’t be loaded.</p>
    );
  }
  const shown = unreadOnly ? loaded.groups.filter((group) => group.unread) : loaded.groups;
  return (
    <section className="flex flex-col gap-4 font-sans" aria-label="Notifications">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show" className="flex gap-1">
          <Button
            size="sm"
            variant={unreadOnly ? 'ghost' : 'secondary'}
            aria-pressed={!unreadOnly}
            className="max-md:min-h-11"
            onClick={() => setUnreadOnly(false)}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={unreadOnly ? 'secondary' : 'ghost'}
            aria-pressed={unreadOnly}
            className="max-md:min-h-11"
            onClick={() => setUnreadOnly(true)}
          >
            Unread{loaded.unread === 0 ? '' : ` (${loaded.unread})`}
          </Button>
        </div>
        {loaded.unread === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto max-md:min-h-11"
            onClick={() => void read({ all: true })}
          >
            Mark all read
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-body text-muted-foreground">
          {unreadOnly
            ? 'Nothing unread.'
            : 'Nothing yet. When collaborators do something you’d want to know about, it shows up here.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((group) => {
            const ids = group.items.filter((item) => item.unread).map((item) => item.id);
            const expanded = open.has(group.key);
            return (
              <li
                key={group.key}
                data-unread={group.unread}
                className={cn(
                  'border-border-subtle flex gap-3 rounded-md border p-3',
                  group.unread ? 'bg-card' : '',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-2 size-2 shrink-0 rounded-full',
                    group.unread ? 'bg-primary' : 'bg-transparent',
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Entry
                    href={group.href}
                    summary={group.summary}
                    preview={group.preview}
                    unread={group.unread}
                    at={group.latestAt}
                    onOpen={() => {
                      if (ids.length > 0) void markRead({ ids });
                    }}
                  />
                  <div className="flex flex-wrap gap-1">
                    {group.count > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={expanded}
                        className="max-md:min-h-11"
                        onClick={() =>
                          setOpen((current) => {
                            const next = new Set(current);
                            if (expanded) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          })
                        }
                      >
                        {expanded ? 'Show fewer' : `Show all ${group.count}`}
                      </Button>
                    ) : null}
                    {ids.length === 0 ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="max-md:min-h-11"
                        onClick={() => void read({ ids })}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                  {expanded ? (
                    <ul className="border-border-subtle flex flex-col gap-2 border-l pl-3">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <Entry
                            href={item.href}
                            summary={item.summary}
                            preview={item.preview}
                            unread={item.unread}
                            at={item.at}
                            onOpen={() => {
                              if (item.unread) void markRead({ ids: [item.id] });
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
