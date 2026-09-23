/**
 * Shaping a flat, already-authorized folder list into what the library browser renders: a
 * forest, a flattened order that respects which branches are expanded, and a breadcrumb trail.
 *
 * Pure and synchronous throughout — no query, no authorization decision. Everything here
 * assumes its input already passed through `@youandfriends/authz`'s `loadVisibleFolders`, and
 * treats "not in the list" as "not visible", never as "ask again".
 *
 * **A folder whose parent is not in the list becomes a tree root.** This is not a special case
 * written for scope-limited collaborators (ADR 0010) — it falls out for free from building the
 * tree off the filtered list alone. A full member with a `permission_grants` deny on one branch
 * gets the identical treatment: the denied folder's children, if any grant re-opens one deeper
 * down, surface as roots of their own rather than nested under a parent the viewer cannot see.
 * One rule serves both cases because visibility, not subject kind, is what decides shape here.
 */

export interface VisibleFolder {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly path: string;
}

export interface FolderNode extends VisibleFolder {
  readonly children: readonly FolderNode[];
}

const byName = (a: VisibleFolder, b: VisibleFolder): number => a.name.localeCompare(b.name);

/** Group visible folders into a forest, treating an invisible or absent parent as "no parent". */
export function buildForest(folders: readonly VisibleFolder[]): FolderNode[] {
  const visibleIds = new Set(folders.map((folder) => folder.id));
  const childrenOf = new Map<string | null, VisibleFolder[]>();

  for (const folder of folders) {
    const key =
      folder.parentId !== null && visibleIds.has(folder.parentId) ? folder.parentId : null;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(folder);
    else childrenOf.set(key, [folder]);
  }
  for (const bucket of childrenOf.values()) bucket.sort(byName);

  function build(key: string | null): FolderNode[] {
    return (childrenOf.get(key) ?? []).map((folder) => ({ ...folder, children: build(folder.id) }));
  }

  return build(null);
}

/**
 * The forest as one ordered list — depth-first, children only under an expanded parent.
 *
 * This is "what a screen reader and the arrow keys see": a collapsed node's children are not
 * merely visually hidden, they are absent from the sequence, exactly as the ARIA tree pattern
 * requires (`docs/DESIGN.md`'s tree-view reference, task `040`'s own notes).
 */
export function flattenVisible(
  nodes: readonly FolderNode[],
  expanded: ReadonlySet<string>,
): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: readonly FolderNode[]): void => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && expanded.has(node.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * The path from the current folder's nearest visible ancestor down to itself.
 *
 * Stops the moment an ancestor id is missing from `folders` — which is either the real
 * workspace root (nothing above it to find) or a folder this subject cannot see (a deny, or the
 * edge of a scope-limited grant). Either way, showing a stub for it would be the folder's mere
 * existence leaking through the one control (`docs/THREAT_MODEL.md`) that filtering the list
 * itself was supposed to prevent.
 */
export function breadcrumbFor(
  folders: readonly VisibleFolder[],
  currentId: string | null,
): VisibleFolder[] {
  if (currentId === null) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  const crumbs: VisibleFolder[] = [];
  let cursor: string | null = currentId;
  while (cursor !== null) {
    const folder: VisibleFolder | undefined = byId.get(cursor);
    if (folder === undefined) break;
    crumbs.unshift(folder);
    cursor = folder.parentId;
  }
  return crumbs;
}

/** Whether `candidatePath` names `ancestorPath`'s own folder or something nested under it. */
export function isSelfOrDescendant(ancestorPath: string, candidatePath: string): boolean {
  return candidatePath.startsWith(ancestorPath);
}

/**
 * Rewrite every folder's `path` and `parentId` to name only its own visible ancestors — never
 * the real database values.
 *
 * **This is the fix for a real leak, found in security review.** `readLibraryTree`
 * (`lib/library/folders.ts`) removes every invisible folder from the *list*, but each surviving
 * row's own `path` is the true materialized path and its `parentId` the true parent — both name
 * every real ancestor up to the workspace root, invisible ones included, and both were going
 * straight into the client component's props (and so into the page's network response) before
 * this existed. A scope-limited collaborator (ADR 0010) granted a folder three levels deep would
 * have had its two invisible ancestors' ids handed to them regardless of the row itself being
 * absent — exactly the "folder's mere existence is information" leak this task's own
 * Security/privacy section names, and the same property `breadcrumbFor` and `buildForest`
 * already protect at render time. This is the same protection applied to the data itself, so
 * nothing downstream has to re-derive it or can forget to.
 *
 * The client-side `path` comparisons this survives (`folder-tree.tsx`'s drop-target check,
 * `move-to-dialog.tsx`'s descendant filter) only ever compare two folders that are both already
 * in the visible list, so dropping a common invisible prefix from both changes nothing about
 * which is an ancestor of which — and neither comparison is authoritative besides:
 * `moveLibraryFolder` re-derives the real paths server-side before ever writing anything.
 */
export function sanitizeFolderPaths<T extends VisibleFolder>(folders: readonly T[]): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));

  return folders.map((folder) => {
    const chain: string[] = [];
    let cursor: VisibleFolder | undefined = folder;
    while (cursor !== undefined) {
      chain.unshift(cursor.id);
      cursor = cursor.parentId !== null ? byId.get(cursor.parentId) : undefined;
    }

    const parentId = chain.length > 1 ? (chain[chain.length - 2] ?? null) : null;
    return { ...folder, parentId, path: `/${chain.join('/')}/` };
  });
}
