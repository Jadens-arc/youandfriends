import type { Role } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { filterVisibleFolders, type FolderPath } from './library';
import type { MembershipBaseline, ResolvableGrant } from './resolve';

const NOW = new Date('2026-09-23T12:00:00Z');

const ROOT = 'FOLDER0000000000000000ROOT';
const CHILD = 'FOLDER0000000000000000CHLD';
const GRANDCHILD = 'FOLDER000000000000000GRND';
const SIBLING = 'FOLDER0000000000000000SIBL';
const OTHER_ROOT = 'FOLDER00000000000000OTHER';

/**
 * A small real tree, not a flat list — the shape the "fixture must contain the rows that make
 * the rule bite" rule (CLAUDE.md §13) exists for. `GRANDCHILD` in particular is load-bearing:
 * without a folder *two* levels under a denied or granted one, inheritance down the chain and
 * "stops at the deny" collapse into the same result as "stops at the direct child", and a bug
 * that only shows up a level deeper would pass anyway.
 */
const TREE: FolderPath[] = [
  { id: ROOT, path: `/${ROOT}/` },
  { id: CHILD, path: `/${ROOT}/${CHILD}/` },
  { id: GRANDCHILD, path: `/${ROOT}/${CHILD}/${GRANDCHILD}/` },
  { id: SIBLING, path: `/${ROOT}/${SIBLING}/` },
  { id: OTHER_ROOT, path: `/${OTHER_ROOT}/` },
];

function ids(folders: readonly FolderPath[]): string[] {
  return folders.map((folder) => folder.id).sort();
}

function membership(role: Role): MembershipBaseline {
  return { role, canDownload: false, canInvite: false };
}

function grant(overrides: Partial<ResolvableGrant> & { scopeId: string }): ResolvableGrant {
  return {
    scopeType: 'folder',
    role: 'viewer',
    canDownload: null,
    canInvite: null,
    isDeny: false,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

describe('filterVisibleFolders', () => {
  it('gives a full member every folder in the workspace when nothing narrows it', () => {
    const visible = filterVisibleFolders(TREE, [], membership('editor'), NOW);
    expect(ids(visible)).toEqual(ids(TREE));
  });

  it('gives a non-member nothing at all', () => {
    // No grants, no membership baseline — the tenant-boundary case `loadVisibleFolders` refuses
    // outright; this is the pure resolver's half of that claim.
    expect(filterVisibleFolders(TREE, [], null, NOW)).toEqual([]);
  });

  it('removes a denied branch, including everything nested under it', () => {
    const denied = grant({ scopeId: CHILD, isDeny: true });
    const visible = filterVisibleFolders(TREE, [denied], membership('editor'), NOW);

    // CHILD and its descendant GRANDCHILD are gone; everything outside that branch remains.
    expect(ids(visible)).toEqual([ROOT, OTHER_ROOT, SIBLING].sort());
  });

  it('lets a more specific allow re-open a folder inside a denied branch', () => {
    const denied = grant({ scopeId: CHILD, isDeny: true });
    const reopened = grant({ scopeId: GRANDCHILD, role: 'viewer' });
    const visible = filterVisibleFolders(TREE, [denied, reopened], membership('editor'), NOW);

    // GRANDCHILD's own grant outranks the deny at its ancestor; CHILD itself stays hidden.
    expect(ids(visible)).toEqual([GRANDCHILD, OTHER_ROOT, ROOT, SIBLING].sort());
  });

  it('gives a scope-limited collaborator only a granted folder and its descendants', () => {
    // `membership: null` is exactly what a role-null membership row resolves to (ADR 0010) —
    // their access is entirely the grant below, never a workspace-wide baseline.
    const granted = grant({ scopeId: CHILD, role: 'viewer' });
    const visible = filterVisibleFolders(TREE, [granted], null, NOW);

    expect(ids(visible)).toEqual([CHILD, GRANDCHILD].sort());
  });

  it('never shows a folder from an expired grant', () => {
    const expired = grant({
      scopeId: CHILD,
      role: 'viewer',
      endsAt: new Date(NOW.getTime() - 1000),
    });
    expect(filterVisibleFolders(TREE, [expired], null, NOW)).toEqual([]);
  });

  it('ignores a grant on a scope this tree does not contain', () => {
    const elsewhere = grant({ scopeId: 'FOLDER0000000000000ELSEWHR', role: 'owner' });
    expect(filterVisibleFolders(TREE, [elsewhere], null, NOW)).toEqual([]);
  });
});
