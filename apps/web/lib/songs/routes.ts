import type { Route } from 'next';

import type { SongTab } from './tabs';

/**
 * The song workspace's addresses (task `042`), in one place so a card, a module row, and the
 * song list cannot spell them three ways.
 *
 * Typed as `Route` by assertion: `typedRoutes` cannot check a path with a runtime id in it, and
 * these are the dynamic segments `app/(workspace)/songs/[songId]` and `projects/[projectId]`
 * define.
 */
export function songHref(songId: string, tab?: SongTab): Route {
  const base = `/songs/${encodeURIComponent(songId)}`;
  return (tab === undefined || tab === 'overview' ? base : `${base}?tab=${tab}`) as Route;
}

export function projectHref(projectId: string): Route {
  return `/projects/${encodeURIComponent(projectId)}` as Route;
}

/** A folder opens at whatever depth it now sits; the library page re-derives its path. */
export function folderHref(folderId: string): Route {
  return `/library/${encodeURIComponent(folderId)}` as Route;
}
