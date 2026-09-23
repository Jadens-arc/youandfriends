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
import { Check, Folder as FolderIcon } from 'lucide-react';
import * as React from 'react';

import { isSelfOrDescendant, type VisibleFolder } from '@/lib/library/tree';

export interface MoveToDialogProps {
  readonly folder: VisibleFolder;
  readonly folders: readonly VisibleFolder[];
  readonly editableFolderIds: ReadonlySet<string>;
  readonly mayMoveToRoot: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (
    newParentId: string | null,
  ) => Promise<{ status: 'ok' | 'error'; message?: string }>;
}

/**
 * The keyboard- and screen-reader-accessible alternative to dragging a folder onto another
 * (task `040`'s own requirement: "drag-and-drop **must** have a keyboard-accessible
 * equivalent"). It is not a fallback bolted on beside drag-and-drop — it is the same
 * `moveFolderAction` call the drop handler makes, reached a different way.
 *
 * Destinations are filtered to folders this viewer may edit, excluding the folder itself and
 * anything nested under it — the same rule `moveLibraryFolder` enforces server-side, applied
 * here so an invalid choice is never offered rather than offered and then refused.
 */
export function MoveToDialog({
  folder,
  folders,
  editableFolderIds,
  mayMoveToRoot,
  onOpenChange,
  onSubmit,
}: MoveToDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const destinations = folders
    .filter((candidate) => candidate.id !== folder.id)
    .filter((candidate) => editableFolderIds.has(candidate.id))
    .filter((candidate) => !isSelfOrDescendant(folder.path, candidate.path))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function move(newParentId: string | null) {
    setPending(true);
    setError(null);
    const result = await onSubmit(newParentId);
    setPending(false);
    if (result.status === 'ok') onOpenChange(false);
    else setError(result.message ?? 'That move did not work.');
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{folder.name}”</DialogTitle>
          <DialogDescription>Choose where this folder should live.</DialogDescription>
        </DialogHeader>

        <ul role="list" className="border-border max-h-72 overflow-auto rounded border">
          {mayMoveToRoot && folder.parentId !== null ? (
            <MoveDestinationRow
              label="Workspace root"
              onSelect={() => move(null)}
              disabled={pending}
            />
          ) : null}
          {destinations.map((candidate) => (
            <MoveDestinationRow
              key={candidate.id}
              label={candidate.name}
              onSelect={() => move(candidate.id)}
              disabled={pending || candidate.id === folder.parentId}
              current={candidate.id === folder.parentId}
            />
          ))}
          {destinations.length === 0 && !mayMoveToRoot ? (
            <li className="text-body text-muted-foreground p-3 font-sans">
              There is nowhere else you can move this folder to.
            </li>
          ) : null}
        </ul>

        {error !== null ? (
          <p role="alert" className="text-caption text-destructive font-sans">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDestinationRow({
  label,
  onSelect,
  disabled = false,
  current = false,
}: {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  current?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="text-body hover:bg-border-subtle disabled:text-muted-foreground flex w-full items-center gap-2 px-3 py-2 text-left font-sans disabled:cursor-not-allowed"
      >
        <FolderIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{label}</span>
        {current ? <Check className="size-4 shrink-0" aria-label="Current location" /> : null}
      </button>
    </li>
  );
}
