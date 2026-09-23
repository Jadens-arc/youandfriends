import type { LibraryModules as LibraryModulesData } from '@/lib/library/projects';

import { CollaboratorActivity } from './collaborator-activity';
import { Favorites } from './favorites';
import { RecentSongs } from './recent-songs';
import { SharedWithMe } from './shared-with-me';
import { StorageUsage } from './storage-usage';

export { CollaboratorActivity, Favorites, RecentSongs, SharedWithMe, StorageUsage };

/**
 * The library's secondary modules (`docs/DESIGN.md` §4): recent songs, shared work, favourites,
 * collaborator activity, and storage usage. Every list arrives already filtered by `authz`
 * (`readProjectLibrary`); nothing here decides what may be shown.
 *
 * Trash is listed in §4 too, but it has its own destination and its interface is deferred
 * (task `212`), so it is not duplicated here.
 */
export function LibraryModules({
  modules,
  now,
}: {
  readonly modules: LibraryModulesData;
  readonly now: Date;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
      <RecentSongs songs={modules.recentSongs} now={now} />
      <SharedWithMe shared={modules.sharedWithMe} />
      <Favorites favorites={modules.favorites} />
      <CollaboratorActivity activity={modules.activity} now={now} />
      <StorageUsage usage={modules.storage} />
    </div>
  );
}
