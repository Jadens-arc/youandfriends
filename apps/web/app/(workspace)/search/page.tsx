export const metadata = { title: 'Search · You & Friends' };

/**
 * Search destination.
 *
 * On mobile this is a first-class destination rather than a keyboard shortcut, because there
 * is no keyboard to press ⌘K on. The actual search — across projects, songs, lyrics text, and
 * file names, authorization-filtered in the query — is task `045`.
 */
export default function SearchPage() {
  return (
    <div className="p-6">
      <h1 className="text-title text-foreground font-serif">Search</h1>
      <p className="text-body text-muted-foreground mt-2 font-sans">
        Search across projects, songs, lyrics, and files arrives in task 045.
      </p>
    </div>
  );
}
