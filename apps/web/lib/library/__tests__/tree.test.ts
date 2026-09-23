import { describe, expect, it } from 'vitest';

import {
  breadcrumbFor,
  buildForest,
  flattenVisible,
  isSelfOrDescendant,
  sanitizeFolderPaths,
  type VisibleFolder,
} from '../tree';

/**
 * A tree with a gap: `ORPHAN`'s parent is a real folder id that is simply not in the list — the
 * shape a scope-limited collaborator's filtered result, or a full member's denied branch,
 * always takes (`packages/authz/src/library.ts`). Without a fixture that has this gap, "orphan
 * becomes a root" is untested and a regression to "throw on unknown parent" would not be caught.
 */
const HIDDEN_PARENT = 'FOLDER00000000000000HIDDEN';

const ROOT: VisibleFolder = { id: 'ROOT', name: 'Root', parentId: null, path: '/ROOT/' };
const BETA: VisibleFolder = { id: 'BETA', name: 'Beta', parentId: 'ROOT', path: '/ROOT/BETA/' };
const ALPHA: VisibleFolder = { id: 'ALPHA', name: 'Alpha', parentId: 'ROOT', path: '/ROOT/ALPHA/' };
const GRANDCHILD: VisibleFolder = {
  id: 'GRANDCHILD',
  name: 'Grandchild',
  parentId: 'ALPHA',
  path: '/ROOT/ALPHA/GRANDCHILD/',
};
const ORPHAN: VisibleFolder = {
  id: 'ORPHAN',
  name: 'Orphan',
  parentId: HIDDEN_PARENT,
  path: `/${HIDDEN_PARENT}/ORPHAN/`,
};

describe('buildForest', () => {
  it('nests children under their parent, sorted by name', () => {
    const forest = buildForest([ROOT, BETA, ALPHA]);

    expect(forest).toHaveLength(1);
    expect(forest[0]?.id).toBe('ROOT');
    // Alpha before Beta: alphabetical, not insertion order.
    expect(forest[0]?.children.map((c) => c.id)).toEqual(['ALPHA', 'BETA']);
  });

  it('nests a grandchild two levels deep', () => {
    const forest = buildForest([ROOT, ALPHA, GRANDCHILD]);
    const alpha = forest[0]?.children[0];
    expect(alpha?.id).toBe('ALPHA');
    expect(alpha?.children.map((c) => c.id)).toEqual(['GRANDCHILD']);
  });

  it('treats a folder whose parent is not in the list as a root of its own', () => {
    const forest = buildForest([ORPHAN]);
    expect(forest.map((node) => node.id)).toEqual(['ORPHAN']);
  });

  it('does the same when the parent is genuinely null', () => {
    const forest = buildForest([ROOT]);
    expect(forest[0]?.id).toBe('ROOT');
  });
});

describe('flattenVisible', () => {
  it('omits a collapsed node’s children from the sequence, not merely hiding them', () => {
    const forest = buildForest([ROOT, ALPHA, GRANDCHILD, BETA]);
    const flat = flattenVisible(forest, new Set());
    expect(flat.map((n) => n.id)).toEqual(['ROOT']);
  });

  it('includes children only as their own ancestors are expanded', () => {
    const forest = buildForest([ROOT, ALPHA, GRANDCHILD, BETA]);

    const rootOnly = flattenVisible(forest, new Set(['ROOT']));
    expect(rootOnly.map((n) => n.id)).toEqual(['ROOT', 'ALPHA', 'BETA']);

    const rootAndAlpha = flattenVisible(forest, new Set(['ROOT', 'ALPHA']));
    expect(rootAndAlpha.map((n) => n.id)).toEqual(['ROOT', 'ALPHA', 'GRANDCHILD', 'BETA']);
  });
});

describe('breadcrumbFor', () => {
  it('is empty with no current folder', () => {
    expect(breadcrumbFor([ROOT], null)).toEqual([]);
  });

  it('walks from the root down to the current folder', () => {
    const crumbs = breadcrumbFor([ROOT, ALPHA, GRANDCHILD], 'GRANDCHILD');
    expect(crumbs.map((c) => c.id)).toEqual(['ROOT', 'ALPHA', 'GRANDCHILD']);
  });

  it('stops at the nearest ancestor actually in the list, never inventing a stub for one that is not', () => {
    // The exact case a scope-limited collaborator produces: their granted folder's real
    // ancestors are not in `folders` at all, so the breadcrumb must not claim to know their
    // names — that would be the folder's mere existence leaking through a different door.
    const crumbs = breadcrumbFor([ORPHAN], 'ORPHAN');
    expect(crumbs.map((c) => c.id)).toEqual(['ORPHAN']);
  });
});

describe('isSelfOrDescendant', () => {
  it('is true for the folder itself', () => {
    expect(isSelfOrDescendant(ALPHA.path, ALPHA.path)).toBe(true);
  });

  it('is true for a folder nested under it', () => {
    expect(isSelfOrDescendant(ALPHA.path, GRANDCHILD.path)).toBe(true);
  });

  it('is false for an unrelated folder, even a character-prefixed sibling id', () => {
    // Every segment in a materialized path is `/`-terminated (task `021`), so `/ROOT/ALPHA2/`
    // never starts with `/ROOT/ALPHA/` even though the raw id string does — this is the row
    // that would catch a regression to comparing ids instead of full, delimited paths.
    const sibling: VisibleFolder = {
      id: 'ALPHA2',
      name: 'Alpha 2',
      parentId: 'ROOT',
      path: '/ROOT/ALPHA2/',
    };
    expect(isSelfOrDescendant(ALPHA.path, sibling.path)).toBe(false);
  });
});

describe('sanitizeFolderPaths', () => {
  it('leaves a fully-visible tree unchanged', () => {
    const sanitized = sanitizeFolderPaths([ROOT, ALPHA, GRANDCHILD]);
    expect(sanitized).toEqual([ROOT, ALPHA, GRANDCHILD]);
  });

  it('strips an invisible ancestor from a granted folder’s path and parentId', () => {
    // The exact scenario found in security review: a scope-limited collaborator (ADR 0010)
    // granted only `GRANDCHILD`'s parent, two levels under a workspace root they never see.
    // Before this existed, `GRANDCHILD.path` and `.parentId` still named `ROOT` and `ALPHA`
    // verbatim even when only `GRANDCHILD` itself was ever included in the response —
    // `docs/THREAT_MODEL.md`'s "folder's mere existence is information" leaking through the
    // data itself rather than through an extra row.
    const grantedOnly = sanitizeFolderPaths([GRANDCHILD]);
    expect(grantedOnly).toEqual([{ ...GRANDCHILD, parentId: null, path: '/GRANDCHILD/' }]);
  });

  it('keeps a visible ancestor while dropping only the invisible one above it', () => {
    // ALPHA is visible but ROOT is not: GRANDCHILD's sanitized chain should stop at ALPHA,
    // not collapse all the way to itself — this is the row that would catch a bug that
    // truncates to "self only" regardless of what else is actually visible.
    const sanitized = sanitizeFolderPaths([ALPHA, GRANDCHILD]);
    expect(sanitized).toEqual([
      { ...ALPHA, parentId: null, path: '/ALPHA/' },
      { ...GRANDCHILD, parentId: 'ALPHA', path: '/ALPHA/GRANDCHILD/' },
    ]);
  });

  it('preserves a descendant relationship between two sanitized folders', () => {
    // The client-side code that compares two folders' `path`s (`folder-tree.tsx`'s drop-target
    // check, `move-to-dialog.tsx`'s descendant filter) only ever compares folders that are both
    // already in the visible list, so this is the property that actually has to survive.
    const [sanitizedAlpha, sanitizedGrandchild] = sanitizeFolderPaths([ALPHA, GRANDCHILD]);
    expect(isSelfOrDescendant(sanitizedAlpha!.path, sanitizedGrandchild!.path)).toBe(true);
  });

  it('never lets an unrelated visible folder look like an ancestor', () => {
    const sanitized = sanitizeFolderPaths([BETA, ALPHA, GRANDCHILD]);
    const beta = sanitized.find((f) => f.id === 'BETA')!;
    const grandchild = sanitized.find((f) => f.id === 'GRANDCHILD')!;
    expect(isSelfOrDescendant(beta.path, grandchild.path)).toBe(false);
  });
});
