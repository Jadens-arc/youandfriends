import { SearchPage } from '@/components/command/search-page';

export const metadata = { title: 'Search · You & Friends' };

/**
 * Search destination.
 *
 * On mobile this is a first-class destination rather than a keyboard shortcut, because there
 * is no keyboard to press ⌘K on: the command palette's body (task `045`), full width — search
 * across projects, songs, lyrics, and files, authorization-filtered in the query.
 */
export default function Page() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-title text-foreground font-serif">Search</h1>
      <SearchPage />
    </div>
  );
}
