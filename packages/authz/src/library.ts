import type { Role, WorkspaceId } from '@youandfriends/contracts';
import { forbidden } from '@youandfriends/contracts';
import { permissionGrants, workspaceMemberships, type Database } from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

import { grantsForSubjectInWorkspace } from './authorizer';
import { buildChain, type ChainInput } from './chain';
import { isActive, type MembershipBaseline, resolve, type ResolvableGrant } from './resolve';
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

/**
 * Project and song visibility for the project library (task `041`).
 *
 * The same move as the folder tree above, one level further down the chain: every project card,
 * every recent song, every favourite and every activity row is resolved in memory against one
 * load of the subject's grants and membership row, using the chain `buildChain` already builds
 * for a single check. The library draws dozens of these per page; a `resolveAccess` round trip
 * per item would be the N+1 the task forbids, and a workspace-wide `scopedQuery` would miss a
 * deny on one project exactly as it misses one on a folder.
 */
export interface LibraryAccess {
  /** This subject's role on a folder, from the folder's own materialized path. */
  folder(folderPath: string): Role | null;
  /** This subject's role on a project filed at `folderPath` (`''` when unfiled). */
  project(projectId: string, folderPath: string): Role | null;
  /** This subject's role on a song, through its project and that project's folder. */
  song(songId: string, projectId: string, folderPath: string): Role | null;
  /**
   * Whether an active, non-deny grant *held by this subject* sits anywhere on a project's
   * chain — "somebody shared this with you", as opposed to access that comes only from
   * workspace membership. Drives the "Shared with me" module.
   */
  sharedProject(projectId: string, folderPath: string): boolean;
  /** Song ids this subject holds an active, non-deny grant on directly. */
  readonly directlySharedSongIds: readonly string[];
  /**
   * Song ids this subject holds an active deny on directly. Within a project they can see, these
   * are the only songs hidden from them — anything above the song already allowed the project —
   * so this is exactly the set a card's song count and last activity must leave out.
   */
  readonly deniedSongIds: readonly string[];
}

/** Pure: build a {@link LibraryAccess} over grants already in hand. */
export function libraryAccessFrom(
  grants: readonly ResolvableGrant[],
  membership: MembershipBaseline | null,
  now: Date,
): LibraryAccess {
  const roleOf = (chainInput: ChainInput): Role | null =>
    resolve({ chain: buildChain(chainInput), grants, membership, now }).role;

  const sharing = grants.filter((grant) => !grant.isDeny && isActive(grant, now));

  return {
    folder: (folderPath) => roleOf({ targetFolderPath: folderPath }),
    project: (projectId, folderPath) => roleOf({ projectId, folderPath }),
    song: (songId, projectId, folderPath) => roleOf({ songId, projectId, folderPath }),
    sharedProject(projectId, folderPath) {
      const onChain = new Set(
        buildChain({ projectId, folderPath }).map((link) => `${link.scopeType}:${link.scopeId}`),
      );
      return sharing.some((grant) => onChain.has(`${grant.scopeType}:${grant.scopeId}`));
    },
    directlySharedSongIds: sharing
      .filter((grant) => grant.scopeType === 'song')
      .map((grant) => grant.scopeId),
    deniedSongIds: grants
      .filter((grant) => grant.isDeny && grant.scopeType === 'song' && isActive(grant, now))
      .map((grant) => grant.scopeId),
  };
}

/**
 * Load this subject's {@link LibraryAccess} for one workspace — two queries, however many items
 * the caller then asks about. Fails closed on the tenant boundary exactly like
 * {@link loadVisibleFolders}.
 */
export async function loadLibraryAccess(
  db: Database,
  subject: Subject,
  workspaceId: WorkspaceId,
  now: () => Date = () => new Date(),
): Promise<LibraryAccess> {
  const { grants, membership } = await loadSubjectGrantContext(db, subject, workspaceId);
  return libraryAccessFrom(grants, membership, now());
}

/** A project as {@link projectCollaboratorsFrom} needs it. */
export interface ProjectChain {
  readonly id: string;
  readonly folderPath: string;
}

/** A workspace member as {@link projectCollaboratorsFrom} needs them. */
export interface MemberBaselineRow {
  readonly userId: string;
  /** `null` for a scope-limited collaborator (ADR 0010). */
  readonly role: Role | null;
  readonly canDownload: boolean;
  readonly canInvite: boolean;
}

/** A grant, with the member it belongs to. */
export type MemberGrant = ResolvableGrant & { readonly userId: string };

/**
 * Who can reach each project: every member whose own resolution on that project's chain
 * yields a role. Pure — the same `resolve()` every other decision here uses, once per
 * (member, project) pair, over grants and memberships loaded once.
 *
 * "Collaborators" means exactly "the people this project is open to", never "people in the
 * workspace": a member denied on a folder is absent from every card under it, and a
 * scope-limited collaborator appears only on the projects their grants reach.
 */
export function projectCollaboratorsFrom(
  projects: readonly ProjectChain[],
  members: readonly MemberBaselineRow[],
  grants: readonly MemberGrant[],
  now: Date,
): Map<string, string[]> {
  const grantsByUser = groupGrantsByUser(grants);
  const result = new Map<string, string[]>();
  for (const project of projects) {
    const chain = buildChain({ projectId: project.id, folderPath: project.folderPath });
    result.set(project.id, membersReaching(chain, members, grantsByUser, now));
  }
  return result;
}

/** A song as {@link songCollaboratorsFrom} needs it: its own chain, through its project. */
export interface SongChain {
  readonly id: string;
  readonly projectId: string;
  readonly folderPath: string;
}

/**
 * Who can reach one song (task `042`) — the project rule above, one level further down, so a
 * member denied on the song itself is absent from its header even though the project's card
 * lists them.
 */
export function songCollaboratorsFrom(
  song: SongChain,
  members: readonly MemberBaselineRow[],
  grants: readonly MemberGrant[],
  now: Date,
): string[] {
  const chain = buildChain({
    songId: song.id,
    projectId: song.projectId,
    folderPath: song.folderPath,
  });
  return membersReaching(chain, members, groupGrantsByUser(grants), now);
}

function groupGrantsByUser(grants: readonly MemberGrant[]): Map<string, MemberGrant[]> {
  const grantsByUser = new Map<string, MemberGrant[]>();
  for (const grant of grants) {
    const list = grantsByUser.get(grant.userId) ?? [];
    list.push(grant);
    grantsByUser.set(grant.userId, list);
  }
  return grantsByUser;
}

function membersReaching(
  chain: ReturnType<typeof buildChain>,
  members: readonly MemberBaselineRow[],
  grantsByUser: ReadonlyMap<string, readonly MemberGrant[]>,
  now: Date,
): string[] {
  const people: string[] = [];
  for (const member of members) {
    const membership: MembershipBaseline | null =
      member.role === null
        ? null
        : { role: member.role, canDownload: member.canDownload, canInvite: member.canInvite };
    const access = resolve({
      chain,
      grants: grantsByUser.get(member.userId) ?? [],
      membership,
      now,
    });
    if (access.role !== null) people.push(member.userId);
  }
  return people;
}

/**
 * Load every project's collaborators in one workspace: one query for memberships, one for
 * member grants, then {@link projectCollaboratorsFrom}.
 *
 * **The caller must already have decided the viewer may see each project passed in.** The list
 * of who else can reach a project is membership information (`docs/THREAT_MODEL.md`, asset 3);
 * it is only ever computed for projects that survived the viewer's own visibility filter, so a
 * collaborator never learns who works on something they cannot open.
 */
export async function loadProjectCollaborators(
  db: Database,
  workspaceId: WorkspaceId,
  projects: readonly ProjectChain[],
  now: () => Date = () => new Date(),
): Promise<Map<string, string[]>> {
  if (projects.length === 0) return new Map();
  const { members, grants } = await loadMembersAndGrants(db, workspaceId);
  return projectCollaboratorsFrom(projects, members, grants, now());
}

/**
 * One song's collaborators. The same precondition as {@link loadProjectCollaborators}: **the
 * caller must already have decided the viewer may see this song.**
 */
export async function loadSongCollaborators(
  db: Database,
  workspaceId: WorkspaceId,
  song: SongChain,
  now: () => Date = () => new Date(),
): Promise<string[]> {
  const { members, grants } = await loadMembersAndGrants(db, workspaceId);
  return songCollaboratorsFrom(song, members, grants, now());
}

async function loadMembersAndGrants(
  db: Database,
  workspaceId: WorkspaceId,
): Promise<{ members: MemberBaselineRow[]; grants: MemberGrant[] }> {
  const [members, grants] = await Promise.all([
    db
      .select({
        userId: workspaceMemberships.userId,
        role: workspaceMemberships.role,
        canDownload: workspaceMemberships.canDownload,
        canInvite: workspaceMemberships.canInvite,
      })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, workspaceId))
      .orderBy(workspaceMemberships.createdAt, workspaceMemberships.id),
    db
      .select({
        userId: permissionGrants.subjectId,
        scopeType: permissionGrants.scopeType,
        scopeId: permissionGrants.scopeId,
        role: permissionGrants.role,
        canDownload: permissionGrants.canDownload,
        canInvite: permissionGrants.canInvite,
        isDeny: permissionGrants.isDeny,
        startsAt: permissionGrants.startsAt,
        endsAt: permissionGrants.endsAt,
      })
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.workspaceId, workspaceId),
          eq(permissionGrants.subjectKind, 'member'),
        ),
      ),
  ]);
  return { members, grants };
}
