import { AppError } from '@youandfriends/contracts';
import { cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { libraryContext } from '@/lib/library/context';
import { readFavorites } from '@/lib/library/personal';
import type { FavoriteItem } from '@/lib/library/projects';
import { folderHref, projectHref, songHref } from '@/lib/songs/routes';
import { currentWorkspace } from '@/lib/workspace/current';

export const metadata = { title: 'Favorites · You & Friends' };

const GROUPS = [
  { type: 'song', title: 'Songs' },
  { type: 'project', title: 'Projects' },
  { type: 'folder', title: 'Folders' },
] as const;

function hrefFor(item: FavoriteItem) {
  return item.targetType === 'song'
    ? songHref(item.targetId)
    : item.targetType === 'project'
      ? projectHref(item.targetId)
      : folderHref(item.targetId);
}

/** Favorites (task `044`): this person's own, only the ones they can still open. */
export default async function FavoritesPage() {
  const context = await currentWorkspace();
  if (context === null) notFound();
  const favorites = await readFavorites(libraryContext(context)).catch((error: unknown) => {
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-title text-foreground font-serif">Favorites</h1>
      {favorites.length === 0 ? (
        <p className="text-body text-muted-foreground font-sans">
          Star a song or a project and it will wait for you here.
        </p>
      ) : (
        GROUPS.map(({ type, title }) => {
          const items = favorites.filter((item) => item.targetType === type);
          if (items.length === 0) return null;
          return (
            <section
              key={type}
              aria-labelledby={`favorites-${type}`}
              className="flex flex-col gap-2"
            >
              <h2 id={`favorites-${type}`} className="text-heading text-foreground font-serif">
                {title}
              </h2>
              <ul className="border-border bg-card divide-border-subtle divide-y rounded-md border">
                {items.map((item) => (
                  <li key={item.targetId}>
                    <Link
                      href={hrefFor(item)}
                      className={cn(
                        'text-body text-foreground hover:bg-border-subtle flex min-h-11 items-center px-4 font-sans',
                        transition,
                        focusRing,
                      )}
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
