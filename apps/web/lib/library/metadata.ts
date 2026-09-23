import { withAuditedTransaction } from '@youandfriends/authz';
import {
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  newUlid,
  updateProjectSchema,
  updateSongSchema,
  validationFailed,
  type NotificationEvent,
  type UpdateProjectRequest,
  type UpdateSongRequest,
} from '@youandfriends/contracts';
import { assets, projects, songs } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from './context';

/**
 * Editing song and project metadata (task `043`).
 *
 * Each field is validated by the schema the inline editor also uses, authorized as `edit` on the
 * target, and audited with its before and after values — metadata is exactly what someone
 * changes and later asks "who changed this, and from what?". A request that changes nothing
 * writes nothing, not an empty event.
 */

/**
 * Something a collaborator may want to hear about. Delivery arrives with tasks `095`–`096`;
 * until then the event is raised and a context without a sink drops it — the cause is wired
 * now so the notification center does not have to rediscover every place that changes things.
 */
export type NotificationSink = (event: {
  readonly event: NotificationEvent;
  readonly targetType: 'song' | 'project';
  readonly targetId: string;
  readonly actorId: string;
}) => Promise<void>;

export interface MetadataContext extends LibraryContext {
  readonly notify?: NotificationSink | undefined;
}

function refuse(detail: string): never {
  throw forbidden({ detail });
}

function auditContextOf(context: LibraryContext) {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: context.now ?? (() => new Date()),
    newId: context.newId ?? newUlid,
  };
}

/** The fields that changed, as before/after pairs. Unchanged fields are left out. */
function diff<T extends Record<string, unknown>>(
  current: T,
  requested: { readonly [K in keyof T]?: T[K] | undefined },
): { readonly changes: Partial<T>; readonly before: Partial<T>; readonly after: Partial<T> } {
  const changes: Partial<T> = {};
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  for (const key of Object.keys(requested) as (keyof T)[]) {
    const next = requested[key];
    if (next === undefined || next === current[key]) continue;
    changes[key] = next;
    before[key] = current[key];
    after[key] = next;
  }
  return { changes, before, after };
}

export async function updateSong(
  context: MetadataContext,
  songId: string,
  input: UpdateSongRequest,
): Promise<void> {
  const parsed = updateSongSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  if (!isUlid(songId)) refuse('song id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'song',
    scopeId: songId,
  });

  const [current] = await context.db
    .select({ title: songs.title, artist: songs.artist, status: songs.status, notes: songs.notes })
    .from(songs)
    .where(
      and(
        eq(songs.id, songId),
        eq(songs.workspaceId, context.workspaceId),
        isNull(songs.deletedAt),
      ),
    );
  if (current === undefined) refuse(`song ${songId} is not live`);

  const { changes, before, after } = diff(current, parsed.data);
  if (Object.keys(changes).length === 0) return;

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(songs)
      .set(changes)
      .where(and(eq(songs.id, songId), eq(songs.workspaceId, context.workspaceId)));
    await audit({
      action: 'song.updated',
      targetType: 'song',
      targetId: songId,
      metadata: { change: 'metadata', before, after },
    });
  });
  await context.notify?.({
    event: 'metadata.changed',
    targetType: 'song',
    targetId: songId,
    actorId: context.userId,
  });
}

export async function updateProject(
  context: MetadataContext,
  projectId: string,
  input: UpdateProjectRequest,
): Promise<void> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  if (!isUlid(projectId)) refuse('project id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'project',
    scopeId: projectId,
  });

  const [current] = await context.db
    .select({
      name: projects.name,
      artist: projects.artist,
      status: projects.status,
      coverAssetId: projects.coverAssetId,
    })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, context.workspaceId),
        isNull(projects.deletedAt),
      ),
    );
  if (current === undefined) refuse(`project ${projectId} is not live`);

  // A cover must be this project's own live artwork — not a stem, not another project's image,
  // not another workspace's file named by id.
  const cover = parsed.data.coverAssetId;
  if (cover !== undefined && cover !== null) {
    const [asset] = await context.db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, cover),
          eq(assets.workspaceId, context.workspaceId),
          eq(assets.projectId, projectId),
          eq(assets.kind, 'artwork'),
          isNull(assets.deletedAt),
        ),
      );
    if (asset === undefined) refuse(`asset ${cover} is not this project's artwork`);
  }

  const { changes, before, after } = diff(current, parsed.data);
  if (Object.keys(changes).length === 0) return;

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(projects)
      .set(changes)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, context.workspaceId)));
    await audit({
      action: 'project.updated',
      targetType: 'project',
      targetId: projectId,
      metadata: { change: 'metadata', before, after },
    });
  });
  await context.notify?.({
    event: 'metadata.changed',
    targetType: 'project',
    targetId: projectId,
    actorId: context.userId,
  });
}
