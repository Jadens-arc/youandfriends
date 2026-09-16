import type { ChainLink } from './resolve';

/**
 * The scope chain for a target, most specific first.
 *
 * Built from the materialized folder path rather than by walking parents, which is why
 * task `021` maintains one: `/A/B/C/` already *is* the ancestor list, so the whole chain
 * costs zero extra queries. A per-level walk would run once per check, and a permission
 * check happens on every read in the product.
 *
 * Specificity is an index, not a depth: the target itself is highest and each step outwards
 * is one lower, so a deeper folder always outranks its own ancestors.
 */

/** Ancestor folder ids from a materialized path, outermost first. */
export function foldersInPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

export interface ChainInput {
  readonly songId?: string | undefined;
  readonly projectId?: string | undefined;
  /** The folder the project sits in, as its materialized path. Empty when unfiled. */
  readonly folderPath?: string | undefined;
  /** For a folder target, the folder's own path. */
  readonly targetFolderPath?: string | undefined;
}

/**
 * Assemble the chain for a song, a project, or a folder.
 *
 * Every level present is included, which matters for the deny case: a grant on a folder four
 * levels up is only found if that folder is in the chain, and "only the immediate parent"
 * would silently drop inherited access that an owner believes they granted.
 */
export function buildChain(input: ChainInput): ChainLink[] {
  const links: { scopeType: ChainLink['scopeType']; scopeId: string }[] = [];

  if (input.songId !== undefined) links.push({ scopeType: 'song', scopeId: input.songId });
  if (input.projectId !== undefined) {
    links.push({ scopeType: 'project', scopeId: input.projectId });
  }

  // A folder target's own path ends with itself, so it needs no separate entry.
  const path = input.targetFolderPath ?? input.folderPath ?? '';
  for (const folderId of foldersInPath(path).reverse()) {
    links.push({ scopeType: 'folder', scopeId: folderId });
  }

  // Highest specificity first. Counting down rather than up means adding a level below
  // `song` later does not renumber everything above it.
  return links.map((link, index) => ({ ...link, specificity: links.length - index }));
}
