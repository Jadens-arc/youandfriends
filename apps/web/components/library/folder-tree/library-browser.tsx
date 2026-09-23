'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@youandfriends/ui';
import * as React from 'react';

import { breadcrumbFor, type VisibleFolder } from '@/lib/library/tree';

import { FolderBreadcrumbs } from './breadcrumbs';
import { FolderTree, type FolderMutationResult } from './folder-tree';
import { MobileDrilldown } from './mobile-drilldown';
import { MoveToDialog } from './move-to-dialog';
import { NameDialog } from './name-dialog';

export interface LibraryBrowserProps {
  readonly folders: readonly VisibleFolder[];
  /** A plain array, not a `Set` — this crosses the server/client boundary as a prop. */
  readonly editableFolderIds: readonly string[];
  readonly mayCreateAtRoot: boolean;
  readonly currentFolderId: string | null;
  readonly workspaceId: string;
  readonly createAction: (parentId: string | null, name: string) => Promise<FolderMutationResult>;
  readonly renameAction: (folderId: string, name: string) => Promise<FolderMutationResult>;
  readonly moveAction: (
    folderId: string,
    newParentId: string | null,
  ) => Promise<FolderMutationResult>;
  readonly deleteAction: (folderId: string) => Promise<FolderMutationResult>;
}

type Dialog =
  | { readonly kind: 'create'; readonly parentId: string | null }
  | { readonly kind: 'rename'; readonly folder: VisibleFolder }
  | { readonly kind: 'move'; readonly folder: VisibleFolder }
  | { readonly kind: 'delete'; readonly folder: VisibleFolder }
  | null;

/**
 * The library browser: the desktop tree and the mobile drill-down over one shared set of
 * folders and one shared set of dialogs (task `040`).
 *
 * Desktop and mobile are both rendered, switched with CSS — the same convention
 * `WorkspaceLayout` (task `013`) already uses for its own chrome, and for the same reason: a
 * viewport crossing the breakpoint (a tablet rotated, a resized window) should not unmount and
 * remount the tree, losing its scroll position and its focus.
 */
export function LibraryBrowser({
  folders,
  editableFolderIds,
  mayCreateAtRoot,
  currentFolderId,
  workspaceId,
  createAction,
  renameAction,
  moveAction,
  deleteAction,
}: LibraryBrowserProps) {
  const editable = React.useMemo(() => new Set(editableFolderIds), [editableFolderIds]);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [pendingDelete, setPendingDelete] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const mobileChildren = React.useMemo(
    () => folders.filter((folder) => folder.parentId === currentFolderId),
    [folders, currentFolderId],
  );

  async function handleDelete(folder: VisibleFolder) {
    setPendingDelete(true);
    setDeleteError(null);
    const result = await deleteAction(folder.id);
    setPendingDelete(false);
    if (result.status === 'ok') setDialog(null);
    else setDeleteError(result.message ?? 'That folder could not be deleted.');
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 border-b px-3 py-2">
        <FolderBreadcrumbs crumbs={breadcrumbFor(folders, currentFolderId)} />
      </div>

      <div className="hidden min-h-0 flex-1 md:flex">
        <FolderTree
          folders={folders}
          editableFolderIds={editable}
          mayEditRoot={mayCreateAtRoot}
          currentFolderId={currentFolderId}
          storageKey={`youandfriends:library:tree-expanded:${workspaceId}`}
          onRequestCreate={(parentId) => setDialog({ kind: 'create', parentId })}
          onRequestRename={(folder) => setDialog({ kind: 'rename', folder })}
          onRequestMove={(folder) => setDialog({ kind: 'move', folder })}
          onRequestDelete={(folder) => setDialog({ kind: 'delete', folder })}
          onMove={moveAction}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto md:hidden">
        <MobileDrilldown
          children={mobileChildren}
          currentFolderId={currentFolderId}
          editableFolderIds={editable}
          mayCreateHere={currentFolderId === null ? mayCreateAtRoot : editable.has(currentFolderId)}
          onRequestCreate={(parentId) => setDialog({ kind: 'create', parentId })}
          onRequestRename={(folder) => setDialog({ kind: 'rename', folder })}
          onRequestMove={(folder) => setDialog({ kind: 'move', folder })}
          onRequestDelete={(folder) => setDialog({ kind: 'delete', folder })}
        />
      </div>

      {dialog?.kind === 'create' ? (
        <NameDialog
          key={`create-${dialog.parentId ?? 'root'}`}
          title="New folder"
          description="Name the new folder."
          confirmLabel="Create"
          onOpenChange={(open) => !open && setDialog(null)}
          onSubmit={(name) => createAction(dialog.parentId, name)}
        />
      ) : null}

      {dialog?.kind === 'rename' ? (
        <NameDialog
          key={`rename-${dialog.folder.id}`}
          title="Rename folder"
          description="Choose a new name."
          confirmLabel="Rename"
          initialName={dialog.folder.name}
          onOpenChange={(open) => !open && setDialog(null)}
          onSubmit={(name) => renameAction(dialog.folder.id, name)}
        />
      ) : null}

      {dialog?.kind === 'move' ? (
        <MoveToDialog
          key={`move-${dialog.folder.id}`}
          folder={dialog.folder}
          folders={folders}
          editableFolderIds={editable}
          mayMoveToRoot={mayCreateAtRoot}
          onOpenChange={(open) => !open && setDialog(null)}
          onSubmit={(newParentId) => moveAction(dialog.folder.id, newParentId)}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <DeleteConfirmDialog
          folder={dialog.folder}
          pending={pendingDelete}
          error={deleteError}
          onCancel={() => {
            setDialog(null);
            setDeleteError(null);
          }}
          onConfirm={() => handleDelete(dialog.folder)}
        />
      ) : null}
    </div>
  );
}

function DeleteConfirmDialog({
  folder,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  folder: VisibleFolder;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{folder.name}”?</DialogTitle>
          <DialogDescription>
            This moves the folder and everything in it to the trash. It can be recovered for a while
            afterward.
          </DialogDescription>
        </DialogHeader>
        {error !== null ? (
          <p role="alert" className="text-caption text-destructive font-sans">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
