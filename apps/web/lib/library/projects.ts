import {
  canInWorkspace,
  foldersInPath,
  loadLibraryAccess,
  loadProjectCollaborators,
  type LibraryAccess,
} from '@youandfriends/authz';
import {
  listContentActivityPage,
  listFavoritesOf,
  listRecentSongsPage,
  listSongsByIds,
  listWorkspaceProjects,
  membersOf,
  storageUsage,
  type ActivityRow,
  type ContentActivityAction,
  type FavoriteRow,
  type RecencyCursor,
  type RecencyPage,
  type SongListRow,
} from '@youandfriends/db';

import type { LibraryContext } from './context';
import { resolveCovers, type CoverSource } from './covers';

/**
 * Use cases behind the project library (task `041`): the project cards and the secondary
 * modules beside them.
 *
 * Every list here is loaded as a plain, unauthorized workspace listing from `packages/db` and
 * then filtered through one {@link LibraryAccess} — one load of this subject's grants, however
 * many items are asked about — the same shape `readLibraryTree` uses for folders. Nothing that
 * fails that filter leaves this module: not as a card, not as a recent song, not as the target
 * of somebody else's activity. The secondary modules are exactly where an unfiltered query
 * leaks (the task's own Security/privacy note), so each one goes through the same resolver.
 *
 * What crosses into the page is shaped for display and nothing more — no folder paths, no
 * cover asset ids, no audit metadata. A path names every ancestor folder, visible or not; task
 * `040`'s security review found exactly that leak in the tree, and it is not repeated here.
 */

export interface Collaborator {
  readonly userId: string;
  readonly displayName: string;
}

export interface ProjectCard {
  readonly id: string;
  readonly name: string;
  readonly artist: string | null;
  readonly songCount: number;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  /**
   * Cover art for the card: presigned renditions of the project's chosen cover (task `069`), or
   * `null` — no cover chosen, not rendered yet, or no derivatives bucket — for the designed
   * placeholder. Never the original.
   */
  readonly cover: CoverSource | null;
  /** Everyone the project is open to, owners first by join order. */
  readonly collaborators: readonly Collaborator[];
}

export interface SongSummary {
  readonly id: string;
  readonly title: string;
  /**
   * The song's project — or `null` when this viewer cannot open that project (a song shared on
   * its own). A parent the viewer cannot see is never named, the same rule `breadcrumbFor`
   * applies to folders (task `040`).
   */
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly updatedAt: Date;
}

export interface FavoriteItem {
  readonly targetType: 'folder' | 'project' | 'song';
  readonly targetId: string;
  readonly name: string;
  /** For a song, its project — `null` unless this viewer can open that project. */
  readonly projectId: string | null;
}

export interface ActivityItem {
  readonly id: string;
  readonly actorName: string;
  readonly action: ContentActivityAction;
  readonly targetType: 'folder' | 'project' | 'song';
  readonly targetId: string;
  readonly targetName: string;
  /** For a song, its project — `null` unless this viewer can open that project. */
  readonly projectId: string | null;
  readonly occurredAt: Date;
}

export interface SharedWithMe {
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  /** Songs shared directly whose project this viewer cannot otherwise open. */
  readonly songs: readonly SongSummary[];
}

export interface LibraryModules {
  readonly recentSongs: readonly SongSummary[];
  readonly sharedWithMe: SharedWithMe;
  readonly favorites: readonly FavoriteItem[];
  readonly activity: readonly ActivityItem[];
  /** `null` for anyone who may not see workspace settings — a scope-limited collaborator. */
  readonly storage: { readonly usedBytes: number; readonly quotaBytes: number } | null;
}

export interface ProjectLibrary {
  readonly projects: readonly ProjectCard[];
  /** Whether the workspace holds any project this viewer can see at all — the first-run test. */
  readonly hasAnyProject: boolean;
  readonly modules: LibraryModules;
}

/** How many items each secondary module shows. */
export const MODULE_SIZE = 5;

/** Rows scanned per page while filling a module. */
const PAGE_SIZE = 50;
/**
 * The most pages a module will scan before settling for fewer items. Bounds the worst case — a
 * collaborator who can see one song in a workspace of thousands — to a fixed number of
 * queries, rather than a scan of the whole table on every library load.
 */
const MAX_PAGES = 6;

/**
 * Page through a recency listing until `size` visible items are found, the listing ends, or
 * {@link MAX_PAGES} have been read. A fixed `LIMIT` before filtering would hand a limited
 * collaborator an empty module whenever the newest rows happened to be ones they cannot see.
 */
export async function collectVisible<T>(
  loadPage: (after: RecencyCursor | null) => Promise<RecencyPage<T>>,
  isVisible: (item: T) => boolean,
  size: number,
): Promise<T[]> {
  const found: T[] = [];
  let cursor: RecencyCursor | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { items, next } = await loadPage(cursor);
    for (const item of items) {
      if (!isVisible(item)) continue;
      found.push(item);
      if (found.length === size) return found;
    }
    if (next === null) break;
    cursor = next;
  }
  return found;
}

function songVisible(access: LibraryAccess, row: SongListRow): boolean {
  return access.song(row.id, row.projectId, row.folderPath) !== null;
}

function toSongSummary(access: LibraryAccess, row: SongListRow): SongSummary {
  const projectVisible = access.project(row.projectId, row.folderPath) !== null;
  return {
    id: row.id,
    title: row.title,
    projectId: projectVisible ? row.projectId : null,
    projectName: projectVisible ? row.projectName : null,
    updatedAt: row.updatedAt,
  };
}

export function targetVisible(
  access: LibraryAccess,
  row: Pick<FavoriteRow, 'targetType' | 'targetId' | 'projectId' | 'folderPath'>,
): boolean {
  switch (row.targetType) {
    case 'folder':
      return access.folder(row.folderPath) !== null;
    case 'project':
      return access.project(row.targetId, row.folderPath) !== null;
    case 'song':
      return (
        row.projectId !== null && access.song(row.targetId, row.projectId, row.folderPath) !== null
      );
  }
}

/** A song's project id, only if this viewer can open that project — see {@link SongSummary}. */
export function visibleProjectId(
  access: LibraryAccess,
  row: { readonly projectId: string | null; readonly folderPath: string },
): string | null {
  return row.projectId !== null && access.project(row.projectId, row.folderPath) !== null
    ? row.projectId
    : null;
}

export function toActivityItem(access: LibraryAccess, row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    actorName: row.actorName,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    projectId: visibleProjectId(access, row),
    occurredAt: row.occurredAt,
  };
}

export interface ReadProjectLibraryOptions {
  /**
   * The folder currently open, or `null` at the library root. Projects anywhere beneath it are
   * shown; at the root, every project this viewer can see.
   */
  readonly folderId: string | null;
  /** `YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`, passed in for the same reason as
   *  `readWorkspaceSettings`'s: the caller already parsed the environment. */
  readonly quotaBytes: number;
}

/** The project cards and secondary modules for this subject, filtered by `authz` throughout. */
export async function readProjectLibrary(
  context: LibraryContext,
  options: ReadProjectLibraryOptions,
): Promise<ProjectLibrary> {
  const now = context.now ?? (() => new Date());
  // Loaded first and alone: it is also the tenant-boundary check, and fails closed with
  // `forbidden` for a subject with no membership row — before any listing is read.
  const access = await loadLibraryAccess(context.db, context.subject, context.workspaceId, now);

  const allProjects = await listWorkspaceProjects(
    context.db,
    context.workspaceId,
    access.deniedSongIds,
  );
  const visibleProjects = allProjects.filter(
    (project) => access.project(project.id, project.folderPath) !== null,
  );
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

  const inScope =
    options.folderId === null
      ? visibleProjects
      : visibleProjects.filter((project) =>
          foldersInPath(project.folderPath).includes(options.folderId as string),
        );

  const [
    collaboratorIds,
    members,
    recentSongs,
    favoriteRows,
    activityRows,
    sharedSongRows,
    storage,
    covers,
  ] = await Promise.all([
    // Only visible projects are ever passed: who works on a project is itself information.
    loadProjectCollaborators(context.db, context.workspaceId, inScope, now),
    membersOf(context.db, context.workspaceId),
    collectVisible(
      (after) => listRecentSongsPage(context.db, context.workspaceId, PAGE_SIZE, after),
      (row) => songVisible(access, row),
      MODULE_SIZE,
    ),
    listFavoritesOf(context.db, context.workspaceId, context.userId, PAGE_SIZE),
    collectVisible(
      (after) =>
        listContentActivityPage(context.db, context.workspaceId, context.userId, PAGE_SIZE, after),
      (row) => targetVisible(access, row),
      MODULE_SIZE,
    ),
    listSongsByIds(context.db, context.workspaceId, access.directlySharedSongIds),
    readStorage(context, options.quotaBytes, now),
    // One query for the page's covers — only projects that already passed the filter above.
    resolveCovers(
      context,
      inScope.map((project) => project.id),
    ),
  ]);

  const nameOf = new Map(members.map((member) => [member.userId, member.displayName]));

  const projects: ProjectCard[] = inScope.map((project) => ({
    id: project.id,
    name: project.name,
    artist: project.artist,
    songCount: project.songCount,
    createdAt: project.createdAt,
    lastActivityAt: project.lastActivityAt,
    cover: covers.get(project.id) ?? null,
    collaborators: (collaboratorIds.get(project.id) ?? []).flatMap((userId) => {
      const displayName = nameOf.get(userId);
      return displayName === undefined ? [] : [{ userId, displayName }];
    }),
  }));

  return {
    projects,
    hasAnyProject: visibleProjects.length > 0,
    modules: {
      recentSongs: recentSongs.map((row) => toSongSummary(access, row)),
      sharedWithMe: {
        projects: visibleProjects
          .filter((project) => access.sharedProject(project.id, project.folderPath))
          .slice(0, MODULE_SIZE)
          .map((project) => ({ id: project.id, name: project.name })),
        songs: sharedSongRows
          .filter((row) => !visibleProjectIds.has(row.projectId) && songVisible(access, row))
          .slice(0, MODULE_SIZE)
          .map((row) => toSongSummary(access, row)),
      },
      favorites: favoriteRows
        .filter((row) => targetVisible(access, row))
        .slice(0, MODULE_SIZE)
        .map((row) => ({
          targetType: row.targetType,
          targetId: row.targetId,
          name: row.name,
          projectId: visibleProjectId(access, row),
        })),
      activity: activityRows.map((row) => toActivityItem(access, row)),
      storage,
    },
  };
}

/** Storage usage, for anyone who may see workspace settings — the same gate as the settings
 *  page (`readWorkspaceSettings`), so the library never shows more than settings would. */
async function readStorage(
  context: LibraryContext,
  quotaBytes: number,
  now: () => Date,
): Promise<LibraryModules['storage']> {
  const allowed = await canInWorkspace(
    context.db,
    context.subject,
    'view_settings',
    context.workspaceId,
  );
  if (!allowed) return null;
  const usage = await storageUsage(context.db, context.workspaceId, now());
  return usage === null ? null : { usedBytes: usage.usedBytes, quotaBytes };
}
