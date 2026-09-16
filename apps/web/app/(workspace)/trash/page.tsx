export const metadata = { title: 'Trash · You & Friends' };

/** Placeholder destination, so the shell's navigation can be exercised end to end. */
export default function TrashPage() {
  return (
    <div className="p-6">
      <h1 className="text-title text-foreground font-serif">Trash</h1>
      <p className="text-body text-muted-foreground mt-2 font-sans">
        Soft-deleted items and recovery arrive in deferred task 212.
      </p>
    </div>
  );
}
