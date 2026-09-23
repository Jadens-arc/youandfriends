import type { Role, WorkspaceId } from '@youandfriends/contracts';
import { forbidden } from '@youandfriends/contracts';
import type { Database } from '@youandfriends/db';

import { grantsForSubjectInWorkspace } from './authorizer';
import { buildChain } from './chain';
import { type MembershipBaseline, resolve, type ResolvableGrant } from './resolve';
import { inheritsMembership, type Subject } from './subjects';
import { membershipRowOf } from './workspace';

/**
 * Folder visibility for the library browser (task `040`).
 *
 * The library's folder tree needs a different shape of question than the rest of `authz`
 * answers: not "may this subject do X to this one target" but "which of these folders may this
 * subject see at all, and as what role" — the query `docs/DESIGN.md`'s "inaccessible folders
 * are absent from the tree, not merely hidden" requires. `scopedQuery` cannot answer it: it
 * grants a workspace-wide handle only to a full member, and a full member can still hold a
 * `permission_grants` deny on one branch of the tree that scoping by `workspace_id` alone would
 * never see. A scope-limited collaborator (ADR 0010) cannot use it at all — they hold no
 * workspace-wide baseline, and their visibility is entirely their own grants.
 *
 * The approach: resolve each folder independently against its own materialized-path chain, the
 * same way {@link import('./authorizer').createAuthorizer} resolves one target — just without a
 * database round trip per folder, since every grant this subject holds in the workspace is
 * already in hand.
 */

/** The minimum a folder needs to be resolved: its id and its own materialized path. */
export interface FolderPath {
  readonly id: string;
  readonly path: string;
}

/**
 * Every candidate folder's resolved role for this subject, `null` where they have none.
 *
 * Pure and synchronous, and the one place the resolution rule itself runs — one folder, one
 * chain, most-specific-wins — so it is exercised by a table of cases with no database in the
 * loop, the same discipline `resolve.ts` and its task-`023` matrix already follow for
 * single-target checks. {@link filterVisibleFolders} and the library page's "which of these may
 * I edit" both build on this rather than resolving twice.
 */
export function resolveFolderAccess<T extends FolderPath>(
  candidates: readonly T[],
  grants: readonly ResolvableGrant[],
  membership: MembershipBaseline | null,
  now: Date,
): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const folder of candidates) {
    const chain = buildChain({ targetFolderPath: folder.path });
    const access = resolve({ chain, grants, membership, now });
    if (access.role !== null) roles.set(folder.id, access.role);
  }
  return roles;
}

/**
 * Filter folders to the ones this subject may view, pure and synchronous.
 *
 * Kept separate from the database-touching {@link loadVisibleFolders} so the resolution rule
 * stays testable with no database in the loop — see {@link resolveFolderAccess}.
 */
export function filterVisibleFolders<T extends FolderPath>(
  candidates: readonly T[],
  grants: readonly ResolvableGrant[],
  membership: MembershipBaseline | null,
  now: Date,
): T[] {
  const roles = resolveFolderAccess(candidates, grants, membership, now);
  return candidates.filter((folder) => roles.has(folder.id));
}

/**
 * Fails closed on the tenant boundary and loads what {@link resolveFolderAccess} needs.
 *
 * A subject with no membership row in this workspace at all gets `forbidden`, exactly like
 * `scopedQuery` — never an empty result, which would silently confirm the workspace exists. A
 * scope-limited collaborator (a real row with `role: null`) is not refused: their access comes
 * entirely from `grants`, per ADR 0010.
 */
async function loadSubjectGrantContext(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
): Promise<{ grants: ResolvableGrant[]; membership: MembershipBaseline | null }> {
  if (!inheritsMembership(subject)) {
    throw forbidden({ detail: `${subject.kind} cannot browse a workspace's folder tree` });
  }

  const membershipRow = await membershipRowOf(db, subject, workspaceId);
  if (membershipRow === null) {
    throw forbidden({ detail: `user ${subject.userId} is not a member of ${workspaceId}` });
  }

  const grants = await grantsForSubjectInWorkspace(db, workspaceId, subject);
  const membership: MembershipBaseline | null =
    membershipRow.role === null
      ? null
      : {
          role: membershipRow.role,
          canDownload: membershipRow.canDownload,
          canInvite: membershipRow.canInvite,
        };

  return { grants, membership };
}

/**
 * Load and filter every visible folder in a workspace for one subject.
 *
 * Takes the candidate folders as an argument rather than querying for them, so this stays a
 * decision about a set the caller already loaded — `packages/db`'s `listWorkspaceFolders` has
 * no authorization of its own, by design, and this is where that authorization is applied.
 */
export async function loadVisibleFolders<T extends FolderPath>(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
  candidates: readonly T[],
  now: () => Date = () => new Date(),
): Promise<T[]> {
  const { grants, membership } = await loadSubjectGrantContext(db, subject, workspaceId);
  return filterVisibleFolders(candidates, grants, membership, now());
}

/**
 * Load this subject's resolved role on every candidate folder in a workspace.
 *
 * For the library page's "which of these folders may I create in, rename, move, or delete"
 * question (task `040`) — `edit` is the action those require (`docs/DESIGN.md` §3: editors
 * "organize content"), so the caller compares each folder's role with `roleAtLeast(role,
 * 'editor')` rather than repeating a per-folder `assertCan` round trip for a whole tree's worth
 * of affordances.
 */
export async function loadFolderAccess<T extends FolderPath>(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
  candidates: readonly T[],
  now: () => Date = () => new Date(),
): Promise<Map<string, Role>> {
  const { grants, membership } = await loadSubjectGrantContext(db, subject, workspaceId);
  return resolveFolderAccess(candidates, grants, membership, now());
}
