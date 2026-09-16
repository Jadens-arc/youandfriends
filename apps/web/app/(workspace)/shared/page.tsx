export const metadata = { title: 'Shared · You & Friends' };

/** Placeholder destination, so the shell's navigation can be exercised end to end. */
export default function SharedPage() {
  return (
    <div className="p-6">
      <h1 className="text-title text-foreground font-serif">Shared</h1>
      <p className="text-body text-muted-foreground mt-2 font-sans">
        Work shared with you arrives in task 041.
      </p>
    </div>
  );
}
