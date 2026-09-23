import { canInWorkspace, loadLibraryAccess } from '@youandfriends/authz';
import {
  createAssetSchema,
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  newUlid,
  roleAtLeast,
  toFolderPath,
  validationFailed,
  type CreateAssetRequest,
  type UploadableKind,
} from '@youandfriends/contracts';
import {
  assets,
  listWorkspaceProjects,
  listWorkspaceSongs,
  projects,
  songs,
  storageUsage,
  uploadSessions,
} from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';
import {
  recordUploadedVersion,
  type RecordedVersion,
  type VersionContext,
} from '@/lib/versions/service';

/**
 * Files uploaded into a song or a project (task `055`): a master, a stem, a sample, a Project
 * Files entry, artwork. The asset is created first — the upload session needs an asset id — and
 * each finished upload becomes one of its versions.
 *
 * Also the two questions the upload interface asks before offering anything: where may this
 * person upload at all (filtered here, server-side, not merely hidden in a picker), and how much
 * room is left.
 */

function refuse(detail: string): never {
  throw forbidden({ detail });
}

export async function createAsset(
  context: LibraryContext,
  input: CreateAssetRequest,
): Promise<{ readonly assetId: string }> {
  const parsed = createAssetSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const request = parsed.data;

  const scope =
    request.songId !== undefined
      ? ({ scopeType: 'song', scopeId: request.songId } as const)
      : ({ scopeType: 'project', scopeId: request.projectId as string } as const);
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    ...scope,
  });

  const table = scope.scopeType === 'song' ? songs : projects;
  const [owner] = await context.db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.id, scope.scopeId),
        eq(table.workspaceId, context.workspaceId),
        isNull(table.deletedAt),
      ),
    );
  if (owner === undefined) refuse(`${scope.scopeType} ${scope.scopeId} is not live`);

  const assetId = (context.newId ?? newUlid)();
  await context.db.insert(assets).values({
    id: assetId,
    workspaceId: context.workspaceId,
    songId: request.songId ?? null,
    projectId: request.songId === undefined ? (request.projectId ?? null) : null,
    kind: request.kind,
    name: request.name,
    folderPath: request.kind === 'project_file' ? (toFolderPath(request.folder ?? '') ?? '') : '',
    tags: request.tags ?? [],
  });
  return { assetId };
}

/** Record a finished upload as a version of the asset named in the path — and only that one. */
export async function recordAssetVersion(
  context: VersionContext,
  assetId: string,
  sessionId: string,
): Promise<RecordedVersion> {
  if (!isUlid(assetId) || !isUlid(sessionId)) refuse('malformed id');
  const [session] = await context.db
    .select({ assetId: uploadSessions.assetId })
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, sessionId), eq(uploadSessions.workspaceId, context.workspaceId)),
    );
  if (session === undefined || session.assetId !== assetId) {
    refuse(`session ${sessionId} is not an upload into asset ${assetId}`);
  }
  return recordUploadedVersion(context, sessionId);
}

export interface UploadDestination {
  readonly type: 'project' | 'song';
  readonly id: string;
  readonly name: string;
  /** For a song, its project's name — shown so two songs called "Intro" can be told apart. */
  readonly context: string | null;
  readonly kinds: readonly UploadableKind[];
  /** Songs also take mixes, through the version stack. */
  readonly takesMixes: boolean;
}

/**
 * Every project and song this person may upload into — `edit` or better, resolved against one
 * load of their grants. A destination they cannot write to is never sent to the browser.
 */
export async function listUploadDestinations(
  context: LibraryContext,
): Promise<UploadDestination[]> {
  const now = context.now ?? (() => new Date());
  const access = await loadLibraryAccess(context.db, context.subject, context.workspaceId, now);
  const [projectRows, songRows] = await Promise.all([
    listWorkspaceProjects(context.db, context.workspaceId),
    listWorkspaceSongs(context.db, context.workspaceId),
  ]);

  const editable = (role: ReturnType<typeof access.project>) =>
    role !== null && roleAtLeast(role, 'editor');
  const folderOf = new Map(projectRows.map((row) => [row.id, row.folderPath]));
  const projectNames = new Map(projectRows.map((row) => [row.id, row.name]));

  const destinations: UploadDestination[] = [];
  for (const row of projectRows) {
    if (!editable(access.project(row.id, row.folderPath))) continue;
    destinations.push({
      type: 'project',
      id: row.id,
      name: row.name,
      context: null,
      kinds: ['project_file', 'artwork'],
      takesMixes: false,
    });
  }
  for (const row of songRows) {
    const folderPath = folderOf.get(row.projectId);
    if (folderPath === undefined) continue;
    if (!editable(access.song(row.id, row.projectId, folderPath))) continue;
    const projectVisible = access.project(row.projectId, folderPath) !== null;
    destinations.push({
      type: 'song',
      id: row.id,
      name: row.title,
      context: projectVisible ? (projectNames.get(row.projectId) ?? null) : null,
      kinds: ['master', 'stem', 'sample', 'project_file'],
      takesMixes: true,
    });
  }
  return destinations;
}

/**
 * Room left in the workspace, for anyone who may see workspace settings — the same gate the
 * settings page and the library's storage module use. `null` for a scope-limited collaborator,
 * whose uploads are still checked against the quota server-side when a session opens.
 */
export async function readQuota(
  context: LibraryContext,
  quotaBytes: number,
): Promise<{ readonly usedBytes: number; readonly quotaBytes: number } | null> {
  const allowed = await canInWorkspace(
    context.db,
    context.subject,
    'view_settings',
    context.workspaceId,
  );
  if (!allowed) return null;
  const usage = await storageUsage(
    context.db,
    context.workspaceId,
    (context.now ?? (() => new Date()))(),
  );
  return usage === null ? null : { usedBytes: usage.usedBytes, quotaBytes };
}
