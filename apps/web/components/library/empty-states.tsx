import { Disc3, FolderOpen } from 'lucide-react';

/**
 * The library before anything is in it (task `041`). Written to invite, not to apologize: this
 * is the first screen a new workspace sees, and "No results" is the wrong first sentence for a
 * place meant to hold someone's music.
 *
 * `uploadAction` is the slot for the first-upload call to action, filled by task `055` with
 * "Upload your first song" for anyone who may start a project. Someone who may not gets the
 * state alone — no button that goes nowhere (CLAUDE.md §12).
 */
export function FirstRunState({ uploadAction }: { readonly uploadAction?: React.ReactNode }) {
  return (
    <section
      aria-labelledby="library-first-run"
      className="border-border bg-card shadow-paper mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border px-6 py-12 text-center"
    >
      <div
        aria-hidden
        className="bg-ochre/25 text-ochre-text flex size-16 items-center justify-center rounded-full"
      >
        <Disc3 className="size-8" />
      </div>
      <h2 id="library-first-run" className="text-title text-foreground font-serif">
        Your shelf is ready
      </h2>
      <p className="text-body text-muted-foreground max-w-md font-sans">
        This is where your projects will live — every mix, every lyric, every note from the people
        you make them with. Bring in your first song and it will land right here.
      </p>
      {uploadAction ?? null}
    </section>
  );
}

/** A folder with no projects under it — nothing is wrong, it is just not filled yet. */
export function EmptyFolderState({ folderName }: { readonly folderName: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <FolderOpen aria-hidden className="text-muted-foreground size-8" />
      <p className="text-body text-foreground font-serif">Nothing filed in {folderName} yet</p>
      <p className="text-caption text-muted-foreground max-w-sm font-sans">
        Projects you file here, or in any folder inside it, will gather on this shelf.
      </p>
    </div>
  );
}
