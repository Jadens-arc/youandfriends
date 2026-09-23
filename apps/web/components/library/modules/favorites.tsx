import { cn, focusRing, transition } from '@youandfriends/ui';
import type { Route } from 'next';
import Link from 'next/link';

import type { FavoriteItem } from '@/lib/library/projects';

import { ModuleItem, ModuleSection } from './module-section';

const KIND_LABEL: Readonly<Record<FavoriteItem['targetType'], string>> = {
  folder: 'Folder',
  project: 'Project',
  song: 'Song',
};

/** This viewer's own favourites, newest first — only the ones they can still open. */
export function Favorites({ favorites }: { readonly favorites: readonly FavoriteItem[] }) {
  return (
    <ModuleSection
      title="Favorites"
      empty={favorites.length === 0 ? 'Star the songs you keep coming back to.' : null}
    >
      <ul>
        {favorites.map((favorite) => (
          <ModuleItem
            key={`${favorite.targetType}-${favorite.targetId}`}
            primary={
              favorite.targetType === 'folder' ? (
                // A folder opens at whatever depth it now sits; the page re-derives its path.
                <Link
                  href={`/library/${favorite.targetId}` as Route}
                  className={cn('rounded-sm hover:underline', transition, focusRing)}
                >
                  {favorite.name}
                </Link>
              ) : (
                favorite.name
              )
            }
            secondary={KIND_LABEL[favorite.targetType]}
          />
        ))}
      </ul>
    </ModuleSection>
  );
}
