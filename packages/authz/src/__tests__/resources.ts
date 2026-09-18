/**
 * Every tenant-owned resource class, and how to build an IDOR case for it.
 *
 * The registry exists so that adding a resource class without its cross-workspace test is a
 * **build failure rather than an omission nobody notices**. `idor.test.ts` reads the live
 * database and fails if a tenant-owned table is missing from this list, so the cheap path —
 * ship the table, write the test later — is closed.
 *
 * Classes whose tables do not exist yet are listed as `pending` with the task that creates
 * them. That is not a placeholder to be quietly deleted: the completeness check asserts a
 * pending class really has no table, so the entry has to be converted rather than removed
 * when the table lands.
 */

import {
  assetVersions,
  assets,
  derivatives,
  favorites,
  folders,
  mixVersions,
  permissionGrants,
  projects,
  snapshotEntries,
  snapshots,
  songs,
  storageObjects,
  uploadParts,
  uploadSessions,
  workspaceMemberships,
} from '@youandfriends/db';
import type { DirectDatabase } from '@youandfriends/db';
import {
  makeAsset,
  makeAssetVersion,
  makeFolder,
  makeMixVersion,
  makeProject,
  makeSong,
  makeStorageObject,
  makeUser,
  testId,
} from '@youandfriends/db/testing';

import type { ScopedTable } from '../scoped-query';

/**
 * A tenant with a folder, a project, a song, an asset, and a version — everything the seeders
 * below hang off. Built once per seeding call rather than shared, so one class's rows cannot
 * make another class's case pass.
 */
async function seedTree(db: DirectDatabase, workspaceId: string) {
  const folder = await makeFolder(db, workspaceId, `Folder ${testId()}`);
  const project = await makeProject(db, workspaceId, `Project ${testId()}`, folder.id);
  const song = await makeSong(db, workspaceId, project.id, `Song ${testId()}`);
  const asset = await makeAsset(db, workspaceId, { songId: song.id });
  const object = await makeStorageObject(db, workspaceId);
  const version = await makeAssetVersion(db, workspaceId, asset.id, object.id, 1);
  return { folder, project, song, asset, object, version };
}

/**
 * A pending upload session, with everything it hangs off.
 *
 * Returns the session id so the `upload_parts` seeder can attach a part to a real session rather
 * than to an invented id — a part row whose `session_id` matches nothing would satisfy the
 * registry while proving nothing about the table's tenancy.
 */
async function seedUploadSession(db: DirectDatabase, workspaceId: string) {
  const { song, asset } = await seedTree(db, workspaceId);
  const owner = await makeUser(db);
  const sessionId = testId();

  await db.insert(uploadSessions).values({
    id: sessionId,
    workspaceId,
    ownerUserId: owner.id,
    assetId: asset.id,
    objectKey: `w/${workspaceId}/o/${sessionId}`,
    uploadId: `multipart-${sessionId}`,
    maxSizeBytes: 5 * 1024 * 1024,
    contentTypeHint: 'audio/wav',
    partSizeBytes: 5 * 1024 * 1024,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return { sessionId, songId: song.id };
}

/**
 * Puts one row of this class into a workspace, so a negative case has something to fail on.
 *
 * Without this the generated cross-workspace cases were **vacuous**: they created an empty
 * second workspace and then asserted that nothing from it leaked. Deleting the tenant filter
 * from `scopedQuery` would not have failed one of them. A security review caught it; a seeder
 * per class is what makes "registered" mean "covered".
 */
export type Seeder = (db: DirectDatabase, workspaceId: string) => Promise<void>;

/** A resource class with a table today. */
export interface LiveResource {
  readonly status: 'live';
  readonly name: string;
  /**
   * The table, when a scoped handle may read it at all. `null` means the class is deliberately
   * unreachable through `scopedQuery` and has its own guarded read path — which is stronger,
   * not weaker: an unguarded read is not one call away.
   */
  readonly table: ScopedTable | null;
  /** The authz scope this class is reached through, or `null` if it is not directly targetable. */
  readonly scopeType: 'folder' | 'project' | 'song' | null;
  /** Creates a row of this class. Required whenever `table` is set. */
  readonly seed: Seeder;
  readonly why: string;
}

/** A resource class whose table arrives in a later task. */
export interface PendingResource {
  readonly status: 'pending';
  readonly name: string;
  /** The table name it will create. The completeness check asserts it does not exist yet. */
  readonly tableName: string;
  readonly task: string;
  readonly why: string;
}

export type SensitiveResource = LiveResource | PendingResource;

/**
 * The classes named in task `023`, plus every tenant-owned table that already exists.
 *
 * `docs/ARCHITECTURE.md` §4 is the source for what is coming; the completeness check is the
 * source for what is here.
 */
export const SENSITIVE_RESOURCES: readonly SensitiveResource[] = [
  {
    status: 'live',
    name: 'folders',
    table: folders,
    scopeType: 'folder',
    seed: async (db, workspaceId) => {
      await makeFolder(db, workspaceId, `Folder ${testId()}`);
    },
    why: 'The organizational spine. A leaked folder id leaks the shape of someone’s work.',
  },
  {
    status: 'live',
    name: 'projects',
    table: projects,
    scopeType: 'project',
    seed: async (db, workspaceId) => {
      await makeProject(db, workspaceId, `Project ${testId()}`);
    },
    why: 'Unreleased work, by name and artist.',
  },
  {
    status: 'live',
    name: 'songs',
    table: songs,
    scopeType: 'song',
    seed: async (db, workspaceId) => {
      await seedTree(db, workspaceId);
    },
    why: 'The asset the whole product exists to protect.',
  },
  {
    status: 'live',
    name: 'favorites',
    table: favorites,
    scopeType: null,
    seed: async (db, workspaceId) => {
      const { song } = await seedTree(db, workspaceId);
      const { favorites: table } = await import('@youandfriends/db');
      const [owner] = await db.select().from(workspaceMemberships).limit(1);
      await db.insert(table).values({
        id: testId(),
        workspaceId,
        userId: owner?.userId ?? testId(),
        targetType: 'song',
        targetId: song.id,
      });
    },
    why: 'Reveals what someone is working on, and which collaborators they return to.',
  },
  {
    status: 'live',
    name: 'workspace_memberships',
    table: workspaceMemberships,
    scopeType: null,
    seed: async () => {
      // Created with the tenant itself; `makeTenant` inserts the owner's membership.
    },
    why: 'The membership list is the collaborator list. Enumerating it is reconnaissance.',
  },
  {
    status: 'live',
    name: 'permission_grants',
    table: permissionGrants,
    scopeType: null,
    seed: async (db, workspaceId) => {
      const { song } = await seedTree(db, workspaceId);
      const [owner] = await db.select().from(workspaceMemberships).limit(1);
      await db.insert(permissionGrants).values({
        id: testId(),
        workspaceId,
        scopeType: 'song',
        scopeId: song.id,
        subjectKind: 'member',
        subjectId: owner?.userId ?? testId(),
        role: 'viewer',
      });
    },
    why: 'Reading the grants tells an attacker exactly where the soft edges are.',
  },

  {
    status: 'live',
    name: 'audit_events',
    // Deliberately not readable through a scoped handle. The only path is
    // `queryAuditEvents`, which requires workspace ownership — see `audit-query.ts`.
    table: null,
    scopeType: null,
    seed: async () => {
      // Written only through `withAuditedTransaction`; the scoped-read case does not apply,
      // because `table` is null. `audit.test.ts` covers its own cross-workspace refusal.
    },
    why: 'Who did what, and when. Another tenant\u2019s log is a complete activity record.',
  },

  {
    status: 'live',
    name: 'assets',
    table: assets,
    scopeType: null,
    seed: async (db, workspaceId) => {
      await seedTree(db, workspaceId);
    },
    why: 'Files: stems, project files, artwork. Reached through the song or project that owns them.',
  },
  {
    status: 'live',
    name: 'asset_versions',
    table: assetVersions,
    scopeType: null,
    seed: async (db, workspaceId) => {
      await seedTree(db, workspaceId);
    },
    why: 'Immutable uploaded bytes. Originals are sacred, and they are what the product exists to hold.',
  },
  {
    status: 'live',
    name: 'mix_versions',
    table: mixVersions,
    scopeType: null,
    seed: async (db, workspaceId) => {
      const { song, version } = await seedTree(db, workspaceId);
      await makeMixVersion(db, workspaceId, song.id, version.id, 1);
    },
    why: 'The version stack behind every song, including unreleased mixes.',
  },
  {
    status: 'live',
    name: 'storage_objects',
    table: storageObjects,
    scopeType: null,
    seed: async (db, workspaceId) => {
      await makeStorageObject(db, workspaceId);
    },
    why: 'Bucket keys. A leaked key is a leaked file for the life of a presigned URL.',
  },
  {
    status: 'live',
    name: 'derivatives',
    table: derivatives,
    scopeType: null,
    seed: async (db, workspaceId) => {
      const { version } = await seedTree(db, workspaceId);
      const { derivatives: table } = await import('@youandfriends/db');
      await db.insert(table).values({
        id: testId(),
        workspaceId,
        assetVersionId: version.id,
        kind: 'waveform_peaks',
      });
    },
    why: 'Streaming audio and waveforms. Regenerable, but a leaked one is still the music.',
  },
  {
    status: 'live',
    name: 'snapshots',
    table: snapshots,
    scopeType: null,
    seed: async (db, workspaceId) => {
      const { project } = await seedTree(db, workspaceId);
      await db.insert(snapshots).values({
        id: testId(),
        workspaceId,
        projectId: project.id,
        source: 'mac_agent',
        name: 'Session',
      });
    },
    why: 'A captured project folder: what someone\u2019s working directory looked like.',
  },
  {
    status: 'live',
    name: 'snapshot_entries',
    table: snapshotEntries,
    scopeType: null,
    seed: async (db, workspaceId) => {
      const { project } = await seedTree(db, workspaceId);
      const snapshotId = testId();
      await db.insert(snapshots).values({
        id: snapshotId,
        workspaceId,
        projectId: project.id,
        source: 'mac_agent',
        name: 'Session',
      });
      await db.insert(snapshotEntries).values({
        id: testId(),
        workspaceId,
        snapshotId,
        relativePath: 'Audio Files/Take 1.wav',
        sizeBytes: 10,
      });
    },
    why: 'The file listing inside a snapshot. Reveals structure and naming even without bytes.',
  },

  // Not yet created. Each is converted to `live` by the task that builds its table; the
  // completeness check below fails if one of these quietly appears without being converted.
  {
    status: 'pending',
    name: 'lyrics_documents',
    tableName: 'lyrics_documents',
    task: '081',
    why: 'Unpublished words, which are as sensitive as unreleased audio.',
  },
  {
    status: 'pending',
    name: 'lyrics_revisions',
    tableName: 'lyrics_revisions',
    task: '083',
    why: 'Every earlier draft of the same.',
  },
  {
    status: 'pending',
    name: 'comment_threads',
    tableName: 'comment_threads',
    task: '090',
    why: 'Private discussion between collaborators.',
  },
  {
    status: 'pending',
    name: 'comments',
    tableName: 'comments',
    task: '090',
    why: 'The same, at message granularity.',
  },
  {
    status: 'pending',
    name: 'notifications',
    tableName: 'notifications',
    task: '095',
    why: 'Reveals activity, timing, and who is working with whom.',
  },
  {
    status: 'live',
    name: 'upload_sessions',
    table: uploadSessions,
    scopeType: 'song',
    seed: async (db, workspaceId) => {
      await seedUploadSession(db, workspaceId);
    },
    why: 'An in-flight session is a writable handle to storage.',
  },
  {
    status: 'live',
    name: 'upload_parts',
    table: uploadParts,
    scopeType: 'song',
    seed: async (db, workspaceId) => {
      const { sessionId } = await seedUploadSession(db, workspaceId);
      await db.insert(uploadParts).values({
        id: testId(),
        workspaceId,
        sessionId,
        partNumber: 1,
        etag: 'etag-1',
        sizeBytes: 5 * 1024 * 1024,
      });
    },
    why: 'Each row names a part already in the bucket, with its ETag. Reading another workspace\u2019s parts is half of hijacking their upload.',
  },
  {
    status: 'pending',
    name: 'share_links',
    tableName: 'share_links',
    task: '200',
    why: 'A share link is a bearer credential. Enumerating them is total compromise.',
  },
  {
    status: 'pending',
    name: 'sync_tokens',
    tableName: 'sync_tokens',
    task: '110',
    why: 'A sync token authorizes a Mac agent. Same.',
  },
];

export const liveResources = SENSITIVE_RESOURCES.filter(
  (resource): resource is LiveResource => resource.status === 'live',
);

export const pendingResources = SENSITIVE_RESOURCES.filter(
  (resource): resource is PendingResource => resource.status === 'pending',
);

/** Tables that are not tenant-owned, and so cannot have a cross-workspace case. */
export const NON_TENANT_TABLES = ['users', 'workspaces', '__drizzle_migrations'] as const;
