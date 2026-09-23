import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { assets } from '../schema/assets';
import { storageObjects } from '../schema/storage-objects';
import { users } from '../schema/users';
import { assetVersions } from '../schema/versions';

/**
 * Project Files reads (task `057`). No authorization here, as everywhere in this package.
 */

/**
 * Every tag in use in a workspace, most-used first — the vocabulary a tag picker suggests from,
 * so "Logic" typed on one song is offered on the next.
 */
export async function workspaceTags(db: Database, workspaceId: string): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(sql`
    select min(tag) as tag
      from (select unnest(${assets.tags}) as tag
              from ${assets}
             where ${assets.workspaceId} = ${workspaceId} and ${assets.deletedAt} is null) as t
     group by lower(tag)
     order by count(*) desc, lower(tag)
     limit 200
  `);
  return rows.rows.map((row) => row.tag);
}

export interface AssetOwnerRow {
  readonly id: string;
  readonly songId: string | null;
  readonly projectId: string | null;
  readonly kind: (typeof assets.$inferSelect)['kind'];
  readonly name: string;
  readonly folderPath: string;
  readonly tags: readonly string[];
}

/** One live asset, with what `authz` needs to decide on it. */
export async function getLiveAsset(
  db: Database,
  workspaceId: string,
  assetId: string,
): Promise<AssetOwnerRow | null> {
  const [row] = await db
    .select({
      id: assets.id,
      songId: assets.songId,
      projectId: assets.projectId,
      kind: assets.kind,
      name: assets.name,
      folderPath: assets.folderPath,
      tags: assets.tags,
    })
    .from(assets)
    .where(
      and(eq(assets.id, assetId), eq(assets.workspaceId, workspaceId), isNull(assets.deletedAt)),
    );
  return row ?? null;
}

export interface ProjectAssetRow {
  readonly assetId: string;
  readonly kind: (typeof assets.$inferSelect)['kind'];
  readonly name: string;
  readonly folderPath: string;
  readonly tags: readonly string[];
  readonly versionCount: number;
  readonly latestSizeBytes: number | null;
  readonly latestUploadedAt: Date | null;
  readonly latestUploaderName: string | null;
  readonly latestProcessingState: (typeof assetVersions.$inferSelect)['processingState'] | null;
}

/** A project's own files (artwork and project-level Project Files), newest version facts each. */
export async function listProjectAssets(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<ProjectAssetRow[]> {
  const latest = db
    .selectDistinctOn([assetVersions.assetId], {
      assetId: assetVersions.assetId,
      sizeBytes: storageObjects.sizeBytes,
      uploadedAt: assetVersions.createdAt,
      uploaderName: users.displayName,
      processingState: assetVersions.processingState,
      versionCount: sql<number>`count(*) over (partition by ${assetVersions.assetId})::int`.as(
        'version_count',
      ),
    })
    .from(assetVersions)
    .innerJoin(
      storageObjects,
      and(
        eq(storageObjects.id, assetVersions.storageObjectId),
        eq(storageObjects.workspaceId, assetVersions.workspaceId),
      ),
    )
    .leftJoin(users, eq(users.id, assetVersions.uploadedBy))
    .where(eq(assetVersions.workspaceId, workspaceId))
    .orderBy(assetVersions.assetId, desc(assetVersions.versionNumber))
    .as('latest');

  const rows = await db
    .select({
      assetId: assets.id,
      kind: assets.kind,
      name: assets.name,
      folderPath: assets.folderPath,
      tags: assets.tags,
      versionCount: sql<number>`coalesce(${latest.versionCount}, 0)::int`,
      latestSizeBytes: latest.sizeBytes,
      latestUploadedAt: latest.uploadedAt,
      latestUploaderName: latest.uploaderName,
      latestProcessingState: latest.processingState,
    })
    .from(assets)
    .leftJoin(latest, eq(latest.assetId, assets.id))
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, projectId),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(asc(assets.folderPath), asc(assets.name), asc(assets.id));

  return rows.map((row) => ({
    ...row,
    latestUploadedAt: row.latestUploadedAt === null ? null : new Date(row.latestUploadedAt),
  }));
}
