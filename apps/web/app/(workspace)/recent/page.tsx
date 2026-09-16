export const metadata = { title: 'Recent · You & Friends' };

/** Placeholder destination, so the shell's navigation can be exercised end to end. */
export default function RecentPage() {
  return (
    <div className="p-6">
      <h1 className="text-title text-foreground font-serif">Recent</h1>
      <p className="text-body text-muted-foreground mt-2 font-sans">
        Recently played and viewed songs arrive in task 044.
      </p>
    </div>
  );
}
