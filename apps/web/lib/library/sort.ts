/**
 * Library view preferences (task `041`): grid or list, and the sort order.
 *
 * Kept in a cookie rather than `localStorage`, unlike the folder tree's expansion state (task
 * `040`): the server has to know the layout before it renders, or a list-mode user gets a grid
 * for one frame and then the whole page jumps — the layout shift the task's acceptance criteria
 * rule out. A cookie is the one per-user store the server can read on the first request.
 */

export const LIBRARY_VIEWS = ['grid', 'list'] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export const LIBRARY_SORTS = ['recent', 'name', 'artist', 'created'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const SORT_LABELS: Readonly<Record<LibrarySort, string>> = {
  recent: 'Recent activity',
  name: 'Name',
  artist: 'Artist',
  created: 'Date created',
};

export const VIEW_COOKIE = 'yaf-library-view';
export const SORT_COOKIE = 'yaf-library-sort';

/** A year: a preference, not a session. */
export const PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const DEFAULT_VIEW: LibraryView = 'grid';
/** "Recently changed" is the library's default ordering (`docs/DESIGN.md` §10). */
export const DEFAULT_SORT: LibrarySort = 'recent';

/** A cookie value is user-controlled input: anything unrecognized is the default. */
export function parseView(value: string | undefined): LibraryView {
  return (LIBRARY_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as LibraryView)
    : DEFAULT_VIEW;
}

export function parseSort(value: string | undefined): LibrarySort {
  return (LIBRARY_SORTS as readonly string[]).includes(value ?? '')
    ? (value as LibrarySort)
    : DEFAULT_SORT;
}

export interface Sortable {
  readonly id: string;
  readonly name: string;
  readonly artist: string | null;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Sort projects for display. Names and artists compare the way a person reads them —
 * case-insensitively, with "Track 2" before "Track 10". Dates are newest first. A project with
 * no artist sorts after every project with one, rather than first as an empty string would.
 * Ties fall back to name, then id, so the order never depends on the input order.
 */
export function sortProjects<T extends Sortable>(projects: readonly T[], sort: LibrarySort): T[] {
  const byName = (a: T, b: T) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);

  const compare: (a: T, b: T) => number = {
    recent: (a: T, b: T) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime() || byName(a, b),
    name: byName,
    artist: (a: T, b: T) => {
      if (a.artist === null && b.artist === null) return byName(a, b);
      if (a.artist === null) return 1;
      if (b.artist === null) return -1;
      return collator.compare(a.artist, b.artist) || byName(a, b);
    },
    created: (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime() || byName(a, b),
  }[sort];

  return [...projects].sort(compare);
}
