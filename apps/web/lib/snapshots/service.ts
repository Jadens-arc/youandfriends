import { withAuditedTransaction, type AuditContext } from '@youandfriends/authz';
import {
  createSnapshotSchema,
  forbidden,
  isUlid,
  newUlid,
  normalizeRelativePath,
  validationFailed,
  type CreateSnapshotRequest,
} from '@youandfriends/contracts';
import { assets, projects, snapshotEntries, snapshots, uploadSessions } from '@youandfriends/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';
import { recordUploadedVersion, type VersionContext } from '@/lib/versions/service';

/**
 * Browser folder snapshots, server side (task `054`).
 *
 * Two steps, around the ordinary upload protocol:
 *
 *   1. {@link createSnapshot} — the manifest arrives, every path is judged **again** here (the
 *      client's check is a courtesy; this one is the control, `docs/THREAT_MODEL.md` T4), and an
 *      unsealed snapshot is written with its entries and a Project Files asset to hold the ZIP.
 *   2. {@link finalizeSnapshot} — once the ZIP's upload session has completed, it becomes a
 *      version of that asset and the snapshot is sealed. From then on the
 *      `snapshots_sealed_when_finalized` and `snapshot_entries_sealed` triggers refuse any change.
 *
 * The ZIP is stored and checksummed, and never opened: nothing here or anywhere on the server
 * expands an archive, which removes the ZIP-bomb class entirely.
 */

function refuse(detail: string): never {
  throw forbidden({ detail });
}

function auditContextOf(context: LibraryContext): AuditContext {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: context.now ?? (() => new Date()),
    newId: context.newId ?? newUlid,
  };
}

export interface CreatedSnapshot {
  readonly snapshotId: string;
  /** The Project Files asset the ZIP is uploaded into. */
  readonly assetId: string;
}

export async function createSnapshot(
  context: LibraryContext,
  input: CreateSnapshotRequest,
): Promise<CreatedSnapshot> {
  const request = createSnapshotSchema.parse(input);

  // Every path, re-judged by the same rule the client used and the database enforces. One bad
  // path refuses the whole manifest rather than silently dropping a file the review promised.
  const problems = request.entries.flatMap((entry, index) => {
    const result = normalizeRelativePath(entry.path);
    return result.ok && result.path === entry.path
      ? []
      : [{ path: `entries.${index}.path`, message: 'This path cannot be stored.' }];
  });
  if (problems.length > 0) throw validationFailed(problems);
  if (new Set(request.entries.map((entry) => entry.path)).size !== request.entries.length) {
    throw validationFailed([{ path: 'entries', message: 'Two entries share a path.' }]);
  }

  if (!isUlid(request.projectId)) refuse('project id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'project',
    scopeId: request.projectId,
  });
  const [project] = await context.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, request.projectId),
        eq(projects.workspaceId, context.workspaceId),
        isNull(projects.deletedAt),
      ),
    );
  if (project === undefined) refuse(`project ${request.projectId} is not live`);

  const newId = context.newId ?? newUlid;
  const snapshotId = newId();

  // The same folder uploaded again is a new *version* of one Project Files entry, not a new entry
  // (task `057`) — or a nightly sync buries the file list within a week.
  const zipName = `${request.name}.zip`;
  const [existing] = await context.db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, context.workspaceId),
        eq(assets.projectId, request.projectId),
        eq(assets.kind, 'project_file'),
        eq(assets.name, zipName),
        isNull(assets.deletedAt),
        sql`'snapshot' = any(${assets.tags})`,
      ),
    )
    .orderBy(assets.createdAt, assets.id)
    .limit(1);
  const assetId = existing?.id ?? newId();

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    if (existing === undefined) {
      await tx.insert(assets).values({
        id: assetId,
        workspaceId: context.workspaceId,
        projectId: request.projectId,
        kind: 'project_file',
        name: zipName,
        tags: ['snapshot'],
      });
    }
    await tx.insert(snapshots).values({
      id: snapshotId,
      workspaceId: context.workspaceId,
      projectId: request.projectId,
      assetId,
      source: 'browser_folder',
      name: request.name,
      createdBy: context.userId,
    });
    // Batched: a manifest may hold thousands of entries.
    for (let start = 0; start < request.entries.length; start += 500) {
      await tx.insert(snapshotEntries).values(
        request.entries.slice(start, start + 500).map((entry) => ({
          id: newId(),
          workspaceId: context.workspaceId,
          snapshotId,
          relativePath: entry.path,
          sizeBytes: entry.sizeBytes,
          modifiedAt: entry.modifiedAt === null ? null : new Date(entry.modifiedAt),
          checksumSha256: entry.checksumSha256,
          ignored: entry.ignored,
          ignoreReason: entry.ignored ? entry.ignoreReason : null,
        })),
      );
    }
    await audit({
      action: 'upload.started',
      targetType: 'snapshot',
      targetId: snapshotId,
      metadata: {
        projectId: request.projectId,
        entries: request.entries.length,
        ignored: request.entries.filter((entry) => entry.ignored).length,
      },
    });
  });

  return { snapshotId, assetId };
}

/**
 * Seal a snapshot with its uploaded ZIP. Idempotent: finalizing an already-sealed snapshot with
 * the same upload answers as the first call did.
 */
export async function finalizeSnapshot(
  context: VersionContext,
  snapshotId: string,
  sessionId: string,
): Promise<{ readonly snapshotId: string; readonly created: boolean }> {
  if (!isUlid(snapshotId)) refuse('snapshot id is not a ULID');
  const [snapshot] = await context.db
    .select({
      id: snapshots.id,
      projectId: snapshots.projectId,
      assetId: snapshots.assetId,
      finalizedAt: snapshots.finalizedAt,
      storageObjectId: snapshots.storageObjectId,
    })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.id, snapshotId),
        eq(snapshots.workspaceId, context.workspaceId),
        isNull(snapshots.deletedAt),
      ),
    );
  if (snapshot === undefined || snapshot.assetId === null) refuse(`no snapshot ${snapshotId}`);

  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'project',
    scopeId: snapshot.projectId,
  });

  // The session must be the ZIP for *this* snapshot's asset.
  const [session] = await context.db
    .select({ assetId: uploadSessions.assetId, storageObjectId: uploadSessions.storageObjectId })
    .from(uploadSessions)
    .where(
      and(eq(uploadSessions.id, sessionId), eq(uploadSessions.workspaceId, context.workspaceId)),
    );
  if (session === undefined || session.assetId !== snapshot.assetId) {
    refuse(`session ${sessionId} is not this snapshot's upload`);
  }

  if (snapshot.finalizedAt !== null) {
    if (snapshot.storageObjectId === session.storageObjectId) {
      return { snapshotId, created: false };
    }
    refuse(`snapshot ${snapshotId} is already sealed`);
  }

  const storageObjectId = session.storageObjectId;
  if (storageObjectId === null) refuse(`session ${sessionId} has not completed`);
  // Refuses someone else's session, and one that has not completed.
  const version = await recordUploadedVersion(context, sessionId);

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(snapshots)
      .set({ storageObjectId, finalizedAt: new Date() })
      .where(and(eq(snapshots.id, snapshotId), isNull(snapshots.finalizedAt)));
    await audit({
      action: 'upload.completed',
      targetType: 'snapshot',
      targetId: snapshotId,
      metadata: { assetVersionId: version.assetVersionId },
    });
  });

  return { snapshotId, created: true };
}
