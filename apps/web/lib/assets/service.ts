import {
  canInWorkspace,
  deleteEntity,
  loadLibraryAccess,
  withAuditedTransaction,
} from '@youandfriends/authz';
import {
  createAssetSchema,
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  newUlid,
  roleAtLeast,
  normalizeTags,
  toFolderPath,
  updateAssetSchema,
  validationFailed,
  type CreateAssetRequest,
  type UpdateAssetRequest,
  type UploadableKind,
} from '@youandfriends/contracts';
import {
  assets,
  getLiveAsset,
  listWorkspaceProjects,
  listWorkspaceSongs,
  projects,
  songs,
  storageUsage,
  uploadSessions,
  workspaceTags,
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
    tags: normalizeTags(request.tags ?? []),
  });
  return { assetId };
}

/** An asset from a request, confirmed live in this workspace and editable by this subject. */
async function loadEditableAsset(context: LibraryContext, assetId: string) {
  if (!isUlid(assetId)) refuse('asset id is not a ULID');
  const asset = await getLiveAsset(context.db, context.workspaceId, assetId);
  if (asset === null) refuse(`asset ${assetId} is not live`);
  // A voice note belongs to its comment (task `093`): it is not a file to rename, re-tag, or
  // trash here. Deleting the comment trashes it — trashing it here would leave a live comment
  // pointing at a recording the purge then cannot remove.
  if (asset.kind === 'voice_note') refuse(`asset ${assetId} is a voice note`);
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: asset.songId === null ? 'project' : 'song',
    scopeId: (asset.songId ?? asset.projectId) as string,
  });
  return asset;
}

/**
 * Rename, move within Project Files, or re-tag a file (task `057`). Audited with what changed,
 * before and after — names and folders are the person's own words, and the redaction deny-list
 * still applies on the way into the log.
 */
export async function updateAsset(
  context: LibraryContext,
  assetId: string,
  input: UpdateAssetRequest,
): Promise<void> {
  const parsed = updateAssetSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const request = parsed.data;
  const asset = await loadEditableAsset(context, assetId);

  const changes: Partial<typeof assets.$inferInsert> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (request.name !== undefined && request.name !== asset.name) {
    changes.name = request.name;
    before.name = asset.name;
    after.name = request.name;
  }
  if (request.folder !== undefined) {
    // Folders are Project Files structure; a mix, a stem, or artwork is not filed in one.
    if (asset.kind !== 'project_file') {
      throw validationFailed([{ path: 'folder', message: 'Only project files go in folders.' }]);
    }
    const folderPath = toFolderPath(request.folder) ?? '';
    if (folderPath !== asset.folderPath) {
      changes.folderPath = folderPath;
      before.folderPath = asset.folderPath;
      after.folderPath = folderPath;
    }
  }
  if (request.tags !== undefined) {
    const tags = normalizeTags(request.tags);
    if (JSON.stringify(tags) !== JSON.stringify(asset.tags)) {
      changes.tags = tags;
      before.tags = asset.tags;
      after.tags = tags;
    }
  }
  if (Object.keys(changes).length === 0) return;

  await withAuditedTransaction(
    context.db,
    {
      workspaceId: context.workspaceId,
      actor: context.subject,
      correlationId: context.correlationId,
      now: context.now ?? (() => new Date()),
      newId: context.newId ?? newUlid,
    },
    async ({ tx, audit }) => {
      await tx
        .update(assets)
        .set(changes)
        .where(and(eq(assets.id, asset.id), eq(assets.workspaceId, context.workspaceId)));
      await audit({
        action: 'asset.updated',
        targetType: 'asset',
        targetId: asset.id,
        metadata: { before, after },
      });
    },
  );
}

/**
 * Move a file to the trash — soft, recoverable for the workspace's recovery window
 * (task `025`), with one audit event per row the cascade touches.
 */
export async function trashAsset(
  context: LibraryContext,
  assetId: string,
  recoveryWindowDays: number,
): Promise<void> {
  const asset = await loadEditableAsset(context, assetId);
  await deleteEntity(
    context.db,
    {
      workspaceId: context.workspaceId,
      actor: context.subject,
      correlationId: context.correlationId,
      recoveryWindowDays,
      ...(context.now === undefined ? {} : { now: context.now }),
      newId: context.newId ?? newUlid,
    },
    'asset',
    asset.id,
  );
}

/** The workspace's tag vocabulary, for anyone who may see anything in it. */
export async function listTags(context: LibraryContext): Promise<string[]> {
  // The membership check `loadLibraryAccess` makes is the tenant boundary here: a person with no
  // membership row is refused before the vocabulary is read.
  await loadLibraryAccess(context.db, context.subject, context.workspaceId, context.now);
  return workspaceTags(context.db, context.workspaceId);
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
