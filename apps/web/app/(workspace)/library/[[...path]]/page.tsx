import { parseServerEnv } from '@youandfriends/config';
import { AppError } from '@youandfriends/contracts';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { LibraryBrowser } from '@/components/library/folder-tree';
import { LibrarySkeleton } from '@/components/library/library-skeleton';
import { libraryContext } from '@/lib/library/context';
import { readLibraryTree } from '@/lib/library/folders';
import { parseSort, parseView, SORT_COOKIE, VIEW_COOKIE } from '@/lib/library/sort';
import { currentWorkspace } from '@/lib/workspace/current';

import {
  createFolderAction,
  deleteFolderAction,
  moveFolderAction,
  renameFolderAction,
} from '../actions';

import { ProjectShelf } from './project-shelf';

export const metadata = { title: 'Library · You & Friends' };

function handleRefusal(error: unknown): never {
  if (error instanceof AppError && error.publicCode === 'not_found') notFound();
  throw error;
}

/**
 * The folder tree and library navigation (task `040`), and the project shelf beside it (task
 * `041`).
 *
 * `[[...path]]` is an optional catch-all rather than a fixed `[folderId]` segment because the
 * drill-down convention this route already has to honor — `MobileHeader` and `BottomNavigation`
 * (task `014`) were both written against `/library`, `/library/<folder>`, and deeper — needs to
 * keep working once tasks `041`–`042` add a project and a song as further segments under the
 * same folder. The last segment is the folder currently open; everything before it is that
 * folder's own path, which this page re-derives from the authorized folder list rather than
 * trusting the URL's shape — the two can disagree (a stale link, a folder moved elsewhere) and
 * the second is a redirect a browser could not usefully act on, so a folder that resolves at
 * all is honored at whatever depth it is now at.
 */
export default async function LibraryPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const context = await currentWorkspace();
  if (context === null) notFound();

  const library = libraryContext(context);
  const tree = await readLibraryTree(library).catch(handleRefusal);

  const currentFolderId = path?.at(-1) ?? null;
  const currentFolder =
    currentFolderId === null
      ? null
      : (tree.folders.find((folder) => folder.id === currentFolderId) ?? null);
  if (currentFolderId !== null && currentFolder === null) {
    // Not visible — indistinguishable from "does not exist" (`docs/THREAT_MODEL.md` T1). A
    // folder from another workspace, one this subject was never granted, or one that was
    // deleted all take the same 404.
    notFound();
  }

  // Display preferences (task `041`). Read here, on the server, so the first paint is already
  // in the chosen layout — see `lib/library/sort.ts`.
  const preferences = await cookies();
  const view = parseView(preferences.get(VIEW_COOKIE)?.value);
  const sort = parseSort(preferences.get(SORT_COOKIE)?.value);

  return (
    <LibraryBrowser
      folders={tree.folders}
      editableFolderIds={[...tree.editableFolderIds]}
      mayCreateAtRoot={tree.mayCreateAtRoot}
      currentFolderId={currentFolderId}
      workspaceId={context.workspace.workspaceId}
      createAction={createFolderAction}
      renameAction={renameFolderAction}
      moveAction={moveFolderAction}
      deleteAction={deleteFolderAction}
    >
      <Suspense key={currentFolderId ?? 'root'} fallback={<LibrarySkeleton view={view} />}>
        <ProjectShelf
          context={library}
          folder={
            currentFolder === null ? null : { id: currentFolder.id, name: currentFolder.name }
          }
          view={view}
          sort={sort}
          quotaBytes={parseServerEnv().YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES}
          mayCreateProject={
            currentFolder === null
              ? tree.mayCreateAtRoot
              : tree.editableFolderIds.has(currentFolder.id)
          }
        />
      </Suspense>
    </LibraryBrowser>
  );
}
