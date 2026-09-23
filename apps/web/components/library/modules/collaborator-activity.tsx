import type { ContentActivityAction } from '@youandfriends/db';
import { cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';

import { formatRelative } from '@/lib/library/format';
import type { ActivityItem } from '@/lib/library/projects';
import { folderHref, projectHref, songHref } from '@/lib/songs/routes';

import { ModuleItem, ModuleSection } from './module-section';

const VERB: Readonly<Record<ContentActivityAction, string>> = {
  'project.updated': 'updated',
  'song.updated': 'updated',
  'folder.updated': 'updated',
  'folder.moved': 'moved',
  'lyrics.updated': 'edited lyrics for',
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
 * What the people this viewer works with have been doing — only to things this viewer can see,
 * and only content changes. Nothing from the audit log's owner-only side (sign-ins, permission
 * changes, downloads) ever reaches here: `CONTENT_ACTIVITY_ACTIONS` is an allow-list.
 */
export function CollaboratorActivity({
  activity,
  now,
}: {
  readonly activity: readonly ActivityItem[];
  readonly now: Date;
}) {
  return (
    <ModuleSection
      title="Collaborator activity"
      empty={
        activity.length === 0
          ? 'Quiet for now. Changes your collaborators make will show up here.'
          : null
      }
    >
      <ul>
        {activity.map((item) => (
          <ModuleItem
            key={item.id}
            primary={
              <>
                <span className="font-medium">{item.actorName}</span> {VERB[item.action]}{' '}
                <Link
                  href={hrefFor(item)}
                  className={cn('rounded-sm font-serif hover:underline', transition, focusRing)}
                >
                  {item.targetName}
                </Link>
              </>
            }
            secondary={
              <time dateTime={item.occurredAt.toISOString()}>
                {formatRelative(item.occurredAt, now)}
              </time>
            }
          />
        ))}
      </ul>
    </ModuleSection>
  );
}
