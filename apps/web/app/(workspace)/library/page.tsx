import { SplitPane } from '@youandfriends/ui';

export const metadata = { title: 'Library · You & Friends' };

/**
 * Library placeholder.
 *
 * Real folders, projects, and songs arrive in tasks `040`–`041`. This exercises the split
 * layout so the shell can be verified before there is data to put in it.
 */
export default function LibraryPage() {
  return (
    <SplitPane
      label="Resize song list"
      storageKey="youandfriends:library:split"
      className="h-full"
      start={
        <div className="p-4">
          <h1 className="text-title text-foreground font-serif">Library</h1>
          <p className="text-body text-muted-foreground mt-2 font-sans">
            Folders, projects, and songs arrive in tasks 040–041.
          </p>
        </div>
      }
      end={
        <div className="p-4">
          <h2 className="text-heading text-foreground font-serif">Select a song</h2>
          <p className="text-body text-muted-foreground mt-2 font-sans">
            The song workspace arrives in task 042.
          </p>
        </div>
      }
    />
  );
}
