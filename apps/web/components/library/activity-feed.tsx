import type { ContentActivityAction } from '@youandfriends/db';
import { cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';

import { formatRelative } from '@/lib/library/format';
import type { ActivityItem } from '@/lib/library/projects';
import { folderHref, projectHref, songHref } from '@/lib/songs/routes';

export const ACTIVITY_VERB: Readonly<Record<ContentActivityAction, string>> = {
  'project.created': 'started',
  'project.updated': 'updated',
  'song.created': 'started',
  'song.updated': 'updated',
  'folder.updated': 'updated',
  'folder.moved': 'moved',
  'lyrics.updated': 'edited lyrics for',
  'lyrics.revision_restored': 'restored an earlier draft of the lyrics for',
  'comment.created': 'commented on',
};

function hrefFor(item: ActivityItem) {
  switch (item.targetType) {
    case 'folder':
      return folderHref(item.targetId);
    case 'project':
      return projectHref(item.targetId);
    case 'song':
      return songHref(item.targetId);
  }
}

/**
 * An activity feed (task `044`): who changed what, newest first, each row already filtered
 * against the viewer's access to its own target. `showTarget` is off on a song's own feed,
 * where every row is about that song.
 */
export function ActivityFeed({
  items,
  now,
  showTarget = true,
  empty,
}: {
  readonly items: readonly ActivityItem[];
  readonly now: Date;
  readonly showTarget?: boolean;
  readonly empty: string;
}) {
  if (items.length === 0) {
    return <p className="text-body text-muted-foreground font-sans italic">{empty}</p>;
  }
  return (
    <ol className="divide-border-subtle flex flex-col divide-y">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col py-2">
          <span className="text-body text-foreground font-sans">
            <span className="font-medium">{item.actorName}</span> {ACTIVITY_VERB[item.action]}
            {showTarget ? (
              <>
                {' '}
                <Link
                  href={hrefFor(item)}
                  className={cn('rounded-sm font-serif hover:underline', transition, focusRing)}
                >
                  {item.targetName}
                </Link>
              </>
            ) : (
              ' this song'
            )}
          </span>
          <time
            dateTime={item.occurredAt.toISOString()}
            className="text-caption text-muted-foreground font-sans"
          >
            {formatRelative(item.occurredAt, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}
