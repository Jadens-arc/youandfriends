import { AppError } from '@youandfriends/contracts';
import { notFound } from 'next/navigation';

import { NewProjectButton } from '@/components/library/create-dialogs';
import { StartFromUpload } from '@/components/upload/start-from-upload';
import { EmptyFolderState, FirstRunState } from '@/components/library/empty-states';
import { LibraryToolbar } from '@/components/library/library-toolbar';
import { LibraryModules } from '@/components/library/modules';
import { ProjectGrid } from '@/components/library/project-grid';
import { QueueSourceButtons } from '@/components/player/queue-actions';
import type { LibraryContext } from '@/lib/library/context';
import { readProjectLibrary } from '@/lib/library/projects';
import { sortProjects, type LibrarySort, type LibraryView } from '@/lib/library/sort';

export interface ProjectShelfProps {
  readonly context: LibraryContext;
  /** The folder open, or `null` at the library root. Already confirmed visible by the page. */
  readonly folder: { readonly id: string; readonly name: string } | null;
  readonly view: LibraryView;
  readonly sort: LibrarySort;
  readonly quotaBytes: number;
  /** Whether this viewer may start a project here — decided server-side by the page. */
  readonly mayCreateProject?: boolean;
}

/**
 * The project shelf and its secondary modules (task `041`).
 *
 * Its own async component so the page can stream it behind a `Suspense` boundary whose fallback
 * is the matching skeleton: the tree and breadcrumbs paint first, and the shelf fills in without
 * moving anything around it.
 *
 * The modules belong to the library's front page, so they appear at the root only. Inside a
 * folder the shelf is just that folder's projects.
 */
export async function ProjectShelf({
  context,
  folder,
  view,
  sort,
  quotaBytes,
  mayCreateProject = false,
}: ProjectShelfProps) {
  const library = await readProjectLibrary(context, {
    folderId: folder?.id ?? null,
    quotaBytes,
  }).catch((error: unknown) => {
    // 404-shaped, like the page's own refusal handling: membership removed between the page's
    // tree read and this streamed read must not surface as anything but "not found".
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });
  const now = (context.now ?? (() => new Date()))();
  const projects = sortProjects(library.projects, sort);

  if (!library.hasAnyProject && folder === null) {
    return (
      <div className="flex flex-col gap-10 p-4 md:p-8">
        <FirstRunState
          uploadAction={
            mayCreateProject ? (
              <div className="flex flex-wrap justify-center gap-2">
                <StartFromUpload />
                <NewProjectButton folderId={null} />
              </div>
            ) : undefined
          }
        />
        <LibraryModules modules={library.modules} now={now} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 p-4 md:p-6 xl:flex-row xl:items-start xl:gap-8">
      <section
        aria-labelledby="library-shelf-heading"
        className="flex min-w-0 flex-1 flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="library-shelf-heading" className="text-title text-foreground font-serif">
            {folder?.name ?? 'Projects'}
          </h1>
          {mayCreateProject ? <NewProjectButton folderId={folder?.id ?? null} /> : null}
          {folder !== null && projects.length > 0 ? (
            <QueueSourceButtons
              selection={{ kind: 'folder', folderId: folder.id }}
              label={folder.name}
            />
          ) : null}
        </div>
        <LibraryToolbar view={view} sort={sort} count={projects.length} />
        {projects.length === 0 && folder !== null ? (
          <EmptyFolderState folderName={folder.name} />
        ) : (
          <ProjectGrid
            projects={projects}
            view={view}
            now={now}
            label={folder === null ? 'Projects' : `Projects in ${folder.name}`}
          />
        )}
      </section>
      {folder === null ? (
        <aside aria-label="Around the library" className="xl:w-72 xl:shrink-0">
          <LibraryModules modules={library.modules} now={now} />
        </aside>
      ) : null}
    </div>
  );
}
