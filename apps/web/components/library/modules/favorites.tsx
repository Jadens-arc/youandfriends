import type { FavoriteItem } from '@/lib/library/projects';
import { folderHref, projectHref, songHref } from '@/lib/songs/routes';

import { ModuleItem, ModuleSection } from './module-section';

const KIND_LABEL: Readonly<Record<FavoriteItem['targetType'], string>> = {
  folder: 'Folder',
  project: 'Project',
  song: 'Song',
};

function hrefFor(favorite: FavoriteItem) {
  switch (favorite.targetType) {
    case 'folder':
      return folderHref(favorite.targetId);
    case 'project':
      return projectHref(favorite.targetId);
    case 'song':
      return songHref(favorite.targetId);
  }
}

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
            primary={favorite.name}
            href={hrefFor(favorite)}
            secondary={KIND_LABEL[favorite.targetType]}
          />
        ))}
      </ul>
    </ModuleSection>
  );
}
