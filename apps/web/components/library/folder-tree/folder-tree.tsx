'use client';

import {
  Button,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  focusRing,
  transition,
} from '@youandfriends/ui';
import { ChevronRight, Folder as FolderIcon, FolderPlus } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  breadcrumbFor,
  buildForest,
  flattenVisible,
  type FolderNode,
  type VisibleFolder,
} from '@/lib/library/tree';

export interface FolderMutationResult {
  readonly status: 'ok' | 'error';
  readonly message?: string;
}

export interface FolderTreeProps {
  readonly folders: readonly VisibleFolder[];
  readonly editableFolderIds: ReadonlySet<string>;
  readonly mayEditRoot: boolean;
  readonly currentFolderId: string | null;
  /** Scopes the persisted expand/collapse state (`docs/DESIGN.md`, "per user rather than per
   *  session" — the same convention `SplitPane`'s `storageKey` already documents). */
  readonly storageKey: string;
  readonly onRequestCreate: (parentId: string | null) => void;
  readonly onRequestRename: (folder: VisibleFolder) => void;
  readonly onRequestMove: (folder: VisibleFolder) => void;
  readonly onRequestDelete: (folder: VisibleFolder) => void;
  readonly onMove: (folderId: string, newParentId: string | null) => Promise<FolderMutationResult>;
}

function readExpanded(storageKey: string): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Private browsing and blocked site data both throw. A forgotten expand state is not
    // worth breaking the tree over.
    return null;
  }
}

function writeExpanded(storageKey: string, expanded: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...expanded]));
  } catch {
    /* see above */
  }
}

/**
 * The folder tree itself: the ARIA tree-view pattern, drag-to-move with a keyboard-accessible
 * alternative, and expand/collapse persisted per user (task `040`).
 *
 * A flat, filtered `folders` list in, a nested `role="tree"` out — everything about *shape*
 * (which folder nests under which, which folder is a root because its real parent is not
 * visible) is decided once in `lib/library/tree.ts`, not re-derived here.
 */
export function FolderTree({
  folders,
  editableFolderIds,
  mayEditRoot,
  currentFolderId,
  storageKey,
  onRequestCreate,
  onRequestRename,
  onRequestMove,
  onRequestDelete,
  onMove,
}: FolderTreeProps) {
  const router = useRouter();

  const forest = React.useMemo(() => buildForest(folders), [folders]);
  const byId = React.useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );

  const defaultExpanded = React.useMemo(
    () => new Set(breadcrumbFor(folders, currentFolderId).map((crumb) => crumb.id)),
    // Only the initial default — recomputing this on every navigation would fight a person who
    // deliberately collapsed something on the way to where they are now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [expanded, setExpandedState] = React.useState<Set<string>>(
    () => readExpanded(storageKey) ?? defaultExpanded,
  );

  const setExpanded = React.useCallback(
    (next: Set<string>) => {
      setExpandedState(next);
      writeExpanded(storageKey, next);
    },
    [storageKey],
  );

  const toggle = React.useCallback(
    (id: string) => {
      const next = new Set(expanded);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setExpanded(next);
    },
    [expanded, setExpanded],
  );

  const flat = React.useMemo(() => flattenVisible(forest, expanded), [forest, expanded]);

  const [focusedId, setFocusedId] = React.useState<string | null>(
    () => currentFolderId ?? flat[0]?.id ?? null,
  );

  // "Adjusting state when a prop changes" (React's own documented alternative to an effect for
  // this): tracked here rather than in a `useEffect` so the follow only ever costs one extra
  // render pass instead of the commit-then-effect-then-recommit cascade an effect would need.
  // Deliberately compared against `currentFolderId` alone — this is "the selection changed",
  // not "the visible list changed", which happens on every expand/collapse too.
  const [trackedFolderId, setTrackedFolderId] = React.useState(currentFolderId);
  if (currentFolderId !== trackedFolderId) {
    setTrackedFolderId(currentFolderId);
    if (currentFolderId !== null && flat.some((node) => node.id === currentFolderId)) {
      setFocusedId(currentFolderId);
    }
  }

  const itemRefs = React.useRef(new Map<string, HTMLDivElement>());
  const focusPending = React.useRef(false);

  React.useLayoutEffect(() => {
    if (!focusPending.current || focusedId === null) return;
    focusPending.current = false;
    itemRefs.current.get(focusedId)?.focus();
  }, [focusedId]);

  const focus = React.useCallback((id: string) => {
    focusPending.current = true;
    setFocusedId(id);
  }, []);

  const navigateTo = React.useCallback(
    (id: string) => {
      const chain = breadcrumbFor(folders, id).map((crumb) => crumb.id);
      router.push(`/library/${chain.join('/')}` as Route);
    },
    [folders, router],
  );

  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | 'root' | null>(null);

  const canDropOn = React.useCallback(
    (targetId: string | null): boolean => {
      if (draggingId === null) return false;
      if (targetId === draggingId) return false;
      if (targetId === null) return mayEditRoot;
      if (!editableFolderIds.has(targetId)) return false;
      const dragged = byId.get(draggingId);
      const target = byId.get(targetId);
      if (!dragged || !target) return false;
      return !target.path.startsWith(dragged.path);
    },
    [draggingId, editableFolderIds, mayEditRoot, byId],
  );

  async function drop(targetId: string | null) {
    const id = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (id === null || !canDropOn(targetId)) return;
    await onMove(id, targetId);
  }

  const typeahead = React.useRef<{ buffer: string; timeout: ReturnType<typeof setTimeout> | null }>(
    {
      buffer: '',
      timeout: null,
    },
  );

  function jumpToTypeahead(character: string) {
    const state = typeahead.current;
    if (state.timeout) clearTimeout(state.timeout);
    state.buffer += character.toLowerCase();
    state.timeout = setTimeout(() => {
      state.buffer = '';
    }, 600);

    const startIndex = flat.findIndex((node) => node.id === focusedId);
    const ordered = [...flat.slice(startIndex + 1), ...flat.slice(0, startIndex + 1)];
    const match = ordered.find((node) => node.name.toLowerCase().startsWith(state.buffer));
    if (match) focus(match.id);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (focusedId === null || flat.length === 0) return;
    const index = flat.findIndex((node) => node.id === focusedId);
    if (index === -1) return;
    const node = flat[index];
    if (!node) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = flat[index + 1];
        if (next) focus(next.id);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const previous = flat[index - 1];
        if (previous) focus(previous.id);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        if (node.children.length === 0) break;
        if (!expanded.has(node.id)) {
          const next = new Set(expanded);
          next.add(node.id);
          setExpanded(next);
        } else {
          const first = node.children[0];
          if (first) focus(first.id);
        }
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        if (node.children.length > 0 && expanded.has(node.id)) {
          const next = new Set(expanded);
          next.delete(node.id);
          setExpanded(next);
        } else {
          const parent = flat.find((candidate) => candidate.id === node.parentId);
          if (parent) focus(parent.id);
        }
        break;
      }
      case 'Home': {
        event.preventDefault();
        const first = flat[0];
        if (first) focus(first.id);
        break;
      }
      case 'End': {
        event.preventDefault();
        const last = flat[flat.length - 1];
        if (last) focus(last.id);
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        navigateTo(node.id);
        break;
      }
      case 'F2': {
        if (editableFolderIds.has(node.id)) {
          event.preventDefault();
          onRequestRename(node);
        }
        break;
      }
      default: {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          jumpToTypeahead(event.key);
        }
      }
    }
  }

  function renderNode(node: FolderNode, depth: number): React.ReactNode {
    const isExpanded = expanded.has(node.id);
    const isFocused = node.id === focusedId;
    const isCurrent = node.id === currentFolderId;
    const editable = editableFolderIds.has(node.id);
    const siblings =
      depth === 0 ? forest : (flat.find((n) => n.id === node.parentId)?.children ?? []);
    const position = siblings.findIndex((sibling) => sibling.id === node.id);

    const row = (
      <div
        ref={(element) => {
          if (element) itemRefs.current.set(node.id, element);
          else itemRefs.current.delete(node.id);
        }}
        role="treeitem"
        id={`library-folder-${node.id}`}
        aria-level={depth + 1}
        aria-setsize={siblings.length}
        aria-posinset={position + 1}
        aria-expanded={node.children.length > 0 ? isExpanded : undefined}
        aria-selected={isCurrent}
        tabIndex={isFocused ? 0 : -1}
        draggable={editable}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', node.id);
          event.dataTransfer.effectAllowed = 'move';
          setDraggingId(node.id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDragOverId(null);
        }}
        onDragOver={(event) => {
          if (!canDropOn(node.id)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDragOverId(node.id);
        }}
        onDragLeave={() => setDragOverId((current) => (current === node.id ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          void drop(node.id);
        }}
        onFocus={() => {
          if (!isFocused) focus(node.id);
        }}
        onClick={() => {
          focus(node.id);
          navigateTo(node.id);
        }}
        style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
        className={cn(
          'group flex h-9 cursor-pointer items-center gap-1.5 rounded-sm pr-2',
          transition,
          focusRing,
          isCurrent && 'bg-border-subtle',
          dragOverId === node.id && 'ring-primary ring-2 ring-inset',
          draggingId === node.id && 'opacity-50',
          !isCurrent && 'hover:bg-border-subtle/60',
        )}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={(event) => {
              event.stopPropagation();
              toggle(node.id);
            }}
            className="text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-sm"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <FolderIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="text-body truncate font-sans">{node.name}</span>
      </div>
    );

    return (
      <div role="none" key={node.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            {editable ? (
              <ContextMenuItem onSelect={() => onRequestCreate(node.id)}>
                New subfolder
              </ContextMenuItem>
            ) : null}
            {editable ? (
              <ContextMenuItem onSelect={() => onRequestRename(node)}>Rename</ContextMenuItem>
            ) : null}
            {editable ? (
              <ContextMenuItem onSelect={() => onRequestMove(node)}>Move to…</ContextMenuItem>
            ) : null}
            {editable ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem destructive onSelect={() => onRequestDelete(node)}>
                  Delete
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
        {node.children.length > 0 && isExpanded ? (
          <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-caption text-muted-foreground font-sans font-medium tracking-wide uppercase">
          Folders
        </h2>
        {mayEditRoot ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRequestCreate(null)}
            aria-label="New folder at the workspace root"
          >
            <FolderPlus aria-hidden />
            New folder
          </Button>
        ) : null}
      </div>

      <div
        role="tree"
        aria-label="Folders"
        className="min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={handleKeyDown}
      >
        {forest.length === 0 ? (
          <p className="text-body text-muted-foreground p-3 font-sans">No folders yet.</p>
        ) : (
          forest.map((node) => renderNode(node, 0))
        )}
      </div>

      {draggingId !== null && mayEditRoot ? (
        <div
          role="treeitem"
          aria-label="Move to workspace root"
          tabIndex={-1}
          onDragOver={(event) => {
            if (!canDropOn(null)) return;
            event.preventDefault();
            setDragOverId('root');
          }}
          onDragLeave={() => setDragOverId((current) => (current === 'root' ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            void drop(null);
          }}
          className={cn(
            'text-body text-muted-foreground flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-dashed px-2 font-sans',
            dragOverId === 'root' && 'border-primary bg-border-subtle',
          )}
        >
          Move to workspace root
        </div>
      ) : null}
    </div>
  );
}
