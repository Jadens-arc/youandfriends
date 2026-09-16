export const metadata = { title: 'Favorites · You & Friends' };

/** Placeholder destination, so the shell's navigation can be exercised end to end. */
export default function FavoritesPage() {
  return (
    <div className="p-6">
      <h1 className="text-title text-foreground font-serif">Favorites</h1>
      <p className="text-body text-muted-foreground mt-2 font-sans">
        Favorited songs and projects arrive in task 044.
      </p>
    </div>
  );
}
