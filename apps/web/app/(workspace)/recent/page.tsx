import { AppError } from '@youandfriends/contracts';
import { cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActivityFeed } from '@/components/library/activity-feed';
import { libraryContext } from '@/lib/library/context';
import { formatRelative } from '@/lib/library/format';
import { readActivity, readRecents, type RecentItem } from '@/lib/library/personal';
import { projectHref, songHref } from '@/lib/songs/routes';
import { currentWorkspace } from '@/lib/workspace/current';

export const metadata = { title: 'Recent · You & Friends' };

function RecentList({
  title,
  items,
  empty,
  now,
}: {
  readonly title: string;
  readonly items: readonly RecentItem[];
  readonly empty: string;
  readonly now: Date;
}) {
  const id = `recent-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-heading text-foreground font-serif">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-body text-muted-foreground font-sans italic">{empty}</p>
      ) : (
        <ul className="border-border bg-card divide-border-subtle divide-y rounded-md border">
          {items.map((item) => (
            <li key={`${item.targetType}-${item.targetId}`}>
              <Link
                href={
                  item.targetType === 'song' ? songHref(item.targetId) : projectHref(item.targetId)
                }
                className={cn(
                  'hover:bg-border-subtle flex min-h-11 flex-col justify-center px-4 py-1.5',
                  transition,
                  focusRing,
                )}
              >
                <span className="text-body text-foreground font-serif">{item.name}</span>
                <span className="text-caption text-muted-foreground font-sans">
                  {item.targetType === 'song' ? (item.projectName ?? 'Song') : 'Project'} ·{' '}
                  <time dateTime={item.occurredAt.toISOString()}>
                    {formatRelative(item.occurredAt, now)}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Recent (task `044`): what this person opened and played lately, and what the people they work
 * with have been changing — every row filtered against the viewer's access to its own target.
 */
export default async function RecentPage() {
  const context = await currentWorkspace();
  if (context === null) notFound();
  const library = libraryContext(context);
  const [recents, activity] = await Promise.all([
    readRecents(library),
    readActivity(library),
  ]).catch((error: unknown) => {
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });
  const now = new Date();

  return (
    <div className="flex flex-col gap-8 p-4 md:p-6 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <h1 className="text-title text-foreground font-serif">Recent</h1>
        <RecentList
          title="Recently played"
          items={recents.played}
          now={now}
          empty="Songs you listen to will gather here."
        />
        <RecentList
          title="Recently viewed"
          items={recents.viewed}
          now={now}
          empty="Songs and projects you open will gather here."
        />
      </div>
      <section
        aria-labelledby="recent-activity"
        className="flex flex-col gap-2 xl:w-96 xl:shrink-0"
      >
        <h2 id="recent-activity" className="text-heading text-foreground font-serif">
          Collaborator activity
        </h2>
        <ActivityFeed
          items={activity}
          now={now}
          empty="Quiet for now. Changes your collaborators make will show up here."
        />
      </section>
    </div>
  );
}
