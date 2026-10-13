'use client';

import { Button, cn, focusRing, transition } from '@youandfriends/ui';
import { ChevronRight, Folder as FolderIcon, FolderPlus, MoreVertical } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { ActionMenu } from '@/components/shell/mobile/sheets/action-menu';
import type { VisibleFolder } from '@/lib/library/tree';

export interface MobileDrilldownProps {
  readonly children: readonly VisibleFolder[];
  readonly currentFolderId: string | null;
  readonly editableFolderIds: ReadonlySet<string>;
  readonly mayCreateHere: boolean;
  readonly onRequestCreate: (parentId: string | null) => void;
  readonly onRequestRename: (folder: VisibleFolder) => void;
  readonly onRequestMove: (folder: VisibleFolder) => void;
  readonly onRequestDelete: (folder: VisibleFolder) => void;
}

/**
 * The phone's way through the folder tree: one level at a time, each a real route
 * (`docs/DESIGN.md` §10 — "drill-down on mobile"; task `040`'s own split from the desktop
 * tree). `MobileHeader` (task `014`) already supplies the back affordance from the URL alone;
 * this supplies the list of what is one level further in, and the same create/rename/move/
 * delete actions the desktop tree's context menu offers, reached here from a per-row overflow
 * menu instead of a right-click.
 */
export function MobileDrilldown({
  children,
  currentFolderId,
  editableFolderIds,
  mayCreateHere,
  onRequestCreate,
  onRequestRename,
  onRequestMove,
  onRequestDelete,
}: MobileDrilldownProps) {
  return (
    <div className="flex flex-col gap-2 p-2">
      {mayCreateHere ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => onRequestCreate(currentFolderId)}
        >
          <FolderPlus aria-hidden />
          New folder
        </Button>
      ) : null}

      {children.length === 0 ? (
        <p className="text-body text-muted-foreground p-3 font-sans">This folder is empty.</p>
      ) : (
        <ul role="list" className="flex flex-col">
          {children
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((folder) => {
              const editable = editableFolderIds.has(folder.id);
              return (
                <li
                  key={folder.id}
                  className="border-border flex items-center border-b last:border-b-0"
                >
                  <Link
                    href={`/library/${folder.id}` as Route}
                    className={cn(
                      'text-body flex min-h-11 flex-1 items-center gap-2 rounded-sm px-2 font-sans',
                      transition,
                      focusRing,
                    )}
                  >
                    <FolderIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{folder.name}</span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  </Link>
                  {editable ? (
                    // A sheet on a phone, a dropdown wherever this drill-down is wider (task `103`).
                    <ActionMenu
                      label={`More actions for ${folder.name}`}
                      title={folder.name}
                      trigger={<MoreVertical className="size-4" aria-hidden />}
                      triggerClassName="text-muted-foreground size-11 shrink-0"
                      actions={[
                        {
                          key: 'subfolder',
                          label: 'New subfolder',
                          onSelect: () => onRequestCreate(folder.id),
                        },
                        { key: 'rename', label: 'Rename', onSelect: () => onRequestRename(folder) },
                        { key: 'move', label: 'Move to…', onSelect: () => onRequestMove(folder) },
                        {
                          key: 'delete',
                          label: 'Delete',
                          onSelect: () => onRequestDelete(folder),
                          destructive: true,
                          separated: true,
                        },
                      ]}
                    />
                  ) : null}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
