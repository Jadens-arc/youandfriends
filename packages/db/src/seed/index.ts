import { inArray, sql } from 'drizzle-orm';

import type { DirectDatabase } from '../client';
import { withTransaction } from '../transaction';
import {
  assetVersions,
  assets,
  derivatives,
  favorites,
  folders,
  mixVersions,
  permissionGrants,
  projects,
  songs,
  storageObjects,
  users,
  workspaceMemberships,
  workspaces,
} from '../schema/index';
import {
  SEED_FOLDERS,
  SEED_GRANTS,
  SEED_PROJECTS,
  SEED_SONGS,
  SEED_USERS,
  SEED_WORKSPACE_ID,
} from './data';
import { generateAllFixtures } from './fixtures/audio';
import type { SeedPermit } from './guard';
import { deterministicId } from './ids';

/**
 * The seed writer.
 *
 * Every insert is an upsert keyed on a deterministic id, so running twice produces the same
 * workspace rather than two of everything. That is worth more than it sounds: a seed that
 * duplicates teaches people to reset reflexively, and resetting reflexively is how someone
 * eventually resets the wrong database.
 *
 * The guard in `guard.ts` runs before any of this. Nothing here checks the environment again,
 * because two half-checks are worse than one that fails closed.
 */

export interface SeedResult {
  readonly workspaceId: string;
  readonly users: number;
  readonly folders: number;
  readonly projects: number;
  readonly songs: number;
  readonly mixVersions: number;
  readonly grants: number;
  readonly fixtureBytes: number;
}

const id = deterministicId;

export async function seed(db: DirectDatabase, _permit: SeedPermit): Promise<SeedResult> {
  const fixtures = generateAllFixtures();

  await db
    .insert(users)
    .values(
      SEED_USERS.map((user) => ({
        id: id(`user:${user.key}`),
        clerkUserId: `user_seed_${user.key}`,
        email: user.email,
        displayName: user.displayName,
      })),
    )
    // `excluded` is the row we tried to insert; the bare table name would be the row already
    // there, which makes the update a self-assignment that silently does nothing. Renaming a
    // collaborator in `SEED_USERS` and re-seeding has to actually rename them, or the next
    // person reaches for `--reset` to work around it.
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: sql`excluded.display_name` },
    });

  const ownerId = id('user:avery');

  await db
    .insert(workspaces)
    .values({ id: SEED_WORKSPACE_ID, name: 'Avery and Friends', ownerUserId: ownerId })
    .onConflictDoNothing();

  await db
    .insert(workspaceMemberships)
    .values(
      SEED_USERS.map((user) => ({
        id: id(`membership:${user.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        userId: id(`user:${user.key}`),
        role: user.role,
        canDownload: user.canDownload,
        canInvite: user.canInvite,
      })),
    )
    .onConflictDoNothing();

  // Folders in declaration order, so a parent always exists before its child. The path trigger
  // from task `021` computes `path` and would reject a parent that is not there yet.
  for (const folder of SEED_FOLDERS) {
    await db
      .insert(folders)
      .values({
        id: id(`folder:${folder.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        name: folder.name,
        parentId: folder.parentKey === undefined ? null : id(`folder:${folder.parentKey}`),
      })
      .onConflictDoNothing();
  }

  await db
    .insert(projects)
    .values(
      SEED_PROJECTS.map((project) => ({
        id: id(`project:${project.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        name: project.name,
        artist: project.artist,
        folderId: project.folderKey === null ? null : id(`folder:${project.folderKey}`),
        status: project.status,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(songs)
    .values(
      SEED_SONGS.map((song) => ({
        id: id(`song:${song.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        projectId: id(`project:${song.projectKey}`),
        title: song.title,
        status: song.status,
      })),
    )
    .onConflictDoNothing();

  // Cover art, for the projects that have it. An asset of kind `artwork` on the project.
  for (const project of SEED_PROJECTS.filter((candidate) => candidate.hasCoverArt)) {
    await db
      .insert(assets)
      .values({
        id: id(`asset:cover:${project.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        projectId: id(`project:${project.key}`),
        kind: 'artwork',
        name: `${project.name} cover.png`,
      })
      .onConflictDoNothing();
  }

  let mixCount = 0;
  let fixtureBytes = 0;

  for (const song of SEED_SONGS) {
    if (song.versions === 0) continue;

    const assetId = id(`asset:mix:${song.key}`);
    await db
      .insert(assets)
      .values({
        id: assetId,
        workspaceId: SEED_WORKSPACE_ID,
        songId: id(`song:${song.key}`),
        kind: 'mix',
        name: `${song.title}.wav`,
        folderPath: '',
        tags: ['mixdown'],
      })
      .onConflictDoNothing();

    for (let number = 1; number <= song.versions; number += 1) {
      // Alternate the two formats so a version stack contains both, which is what a real one
      // looks like once someone bounces at a different rate.
      const fixture = fixtures[(number - 1) % fixtures.length];
      if (!fixture) continue;

      const objectId = id(`object:${song.key}:${number}`);
      const versionId = id(`version:${song.key}:${number}`);
      const isNewest = number === song.versions;
      const failed = song.failedJob === true && isNewest;

      await db
        .insert(storageObjects)
        .values({
          id: objectId,
          workspaceId: SEED_WORKSPACE_ID,
          bucket: 'youandfriends-originals-dev',
          // Opaque, never a user path (THREAT_MODEL T3). The real key format is task `050`'s.
          key: `w/${SEED_WORKSPACE_ID}/o/${objectId}`,
          sizeBytes: fixture.sizeBytes,
          checksumSha256: fixture.checksumSha256,
          contentType: fixture.contentType,
        })
        .onConflictDoNothing();

      fixtureBytes += fixture.sizeBytes;

      await db
        .insert(assetVersions)
        .values({
          id: versionId,
          workspaceId: SEED_WORKSPACE_ID,
          assetId,
          versionNumber: number,
          storageObjectId: objectId,
          uploadedBy: ownerId,
          note: number === 1 ? 'First bounce' : `Revision ${number}`,
          // A failed job leaves the analysis empty, which is the honest state: we do not know
          // the duration of a file we could not read.
          durationMs: failed ? null : fixture.durationMs,
          sampleRateHz: failed ? null : fixture.sampleRateHz,
          bitDepth: failed ? null : fixture.bitDepth,
          channels: failed ? null : fixture.channels,
          codec: failed ? null : fixture.codec,
          processingState: failed ? 'failed' : 'complete',
          processingError: failed ? 'ffprobe: moov atom not found' : null,
        })
        // `asset_versions` is immutable, so a re-run must not try to update one. Doing nothing
        // is the only correct conflict behaviour here, and the trigger would reject anything
        // else — loudly, which is how this was confirmed rather than assumed.
        .onConflictDoNothing();

      if (!failed) {
        await db
          .insert(derivatives)
          .values({
            id: id(`derivative:${song.key}:${number}`),
            workspaceId: SEED_WORKSPACE_ID,
            assetVersionId: versionId,
            kind: 'streaming_audio',
            variant: 'aac-192k',
            processingState: 'complete',
          })
          .onConflictDoNothing();
      }

      await db
        .insert(mixVersions)
        .values({
          id: id(`mix:${song.key}:${number}`),
          workspaceId: SEED_WORKSPACE_ID,
          songId: id(`song:${song.key}`),
          versionNumber: number,
          assetVersionId: versionId,
          uploadedBy: ownerId,
          note: number === 1 ? 'First bounce' : `Revision ${number}`,
        })
        .onConflictDoNothing();

      mixCount += 1;
    }
  }

  await db
    .insert(permissionGrants)
    .values(
      SEED_GRANTS.map((grant) => ({
        id: id(`grant:${grant.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        scopeType: grant.scopeType,
        scopeId: id(`${grant.scopeType}:${grant.scopeKey}`),
        subjectKind: 'member' as const,
        subjectId: id(`user:${grant.userKey}`),
        role: grant.role,
        canDownload: grant.canDownload ?? null,
        isDeny: grant.isDeny ?? false,
        createdByUserId: ownerId,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(favorites)
    .values({
      id: id('favorite:avery-blue-hour'),
      workspaceId: SEED_WORKSPACE_ID,
      userId: ownerId,
      targetType: 'song',
      targetId: id('song:blue-hour-1'),
    })
    .onConflictDoNothing();

  return {
    workspaceId: SEED_WORKSPACE_ID,
    users: SEED_USERS.length,
    folders: SEED_FOLDERS.length,
    projects: SEED_PROJECTS.length,
    songs: SEED_SONGS.length,
    mixVersions: mixCount,
    grants: SEED_GRANTS.length,
    fixtureBytes,
  };
}

/**
 * Remove what the seed created, and nothing else.
 *
 * **Every delete is by deterministic id**, never by workspace. The seeded workspace is the one
 * the whole development environment lives in, so a workspace-wide sweep would take a folder a
 * developer created by hand with it — and these are hard deletes that bypass the soft-delete
 * path in `soft-delete.ts`, so there would be no recovery window and no trail. `--reset` clears
 * seeded data without touching anything else, which is what task `027` asks for and not the
 * same thing as emptying the workspace.
 *
 * It runs in **one transaction**. Without that, a delete that a trigger refuses partway through
 * leaves grants and favourites already gone and content still present — a state that cannot be
 * cleared by running `--reset` again, because it fails at the same row every time.
 *
 * Deletion order is the reverse of the reference graph: the `ON DELETE RESTRICT` between
 * `asset_versions` and `storage_objects` means the objects cannot go first.
 *
 * **The workspace, its users, and their memberships survive**, and re-running the seed rebuilds
 * the content on top of them. That is a choice, not a constraint: those rows are the stable
 * identities the rest of a development session refers to, and recreating them would change
 * nothing except to churn ids that are deterministic anyway. (Audit events would independently
 * prevent deleting the workspace — `audit_events.workspace_id` does not cascade, by task
 * `024`'s design — but the seed writes none, so that rule is not what is holding here.)
 */
export async function reset(db: DirectDatabase, _permit: SeedPermit): Promise<void> {
  const songIds = SEED_SONGS.map((song) => id(`song:${song.key}`));
  const projectIds = SEED_PROJECTS.map((project) => id(`project:${project.key}`));
  // Children before parents, so a folder is never deleted while one of its own is still there.
  const folderIds = [...SEED_FOLDERS].reverse().map((folder) => id(`folder:${folder.key}`));
  const grantIds = SEED_GRANTS.map((grant) => id(`grant:${grant.key}`));
  const favoriteIds = [id('favorite:avery-blue-hour')];
  const assetIds = [
    ...SEED_SONGS.map((song) => id(`asset:mix:${song.key}`)),
    ...SEED_PROJECTS.map((project) => id(`asset:cover:${project.key}`)),
  ];
  const versionIds = SEED_SONGS.flatMap((song) =>
    Array.from({ length: song.versions }, (_, index) => id(`version:${song.key}:${index + 1}`)),
  );
  const objectIds = SEED_SONGS.flatMap((song) =>
    Array.from({ length: song.versions }, (_, index) => id(`object:${song.key}:${index + 1}`)),
  );

  await withTransaction(db, async (tx) => {
    await tx.delete(favorites).where(inArray(favorites.id, favoriteIds));
    await tx.delete(permissionGrants).where(inArray(permissionGrants.id, grantIds));

    if (versionIds.length > 0) {
      await tx.delete(derivatives).where(inArray(derivatives.assetVersionId, versionIds));
    }
    // Songs first: `mix_versions` cascades from the song, and deleting the song also clears
    // `current_version_id` before anything tries to remove the version it points at.
    if (songIds.length > 0) await tx.delete(songs).where(inArray(songs.id, songIds));
    if (versionIds.length > 0) {
      await tx.delete(assetVersions).where(inArray(assetVersions.id, versionIds));
    }
    if (assetIds.length > 0) await tx.delete(assets).where(inArray(assets.id, assetIds));
    if (objectIds.length > 0) {
      await tx.delete(storageObjects).where(inArray(storageObjects.id, objectIds));
    }

    await tx.delete(projects).where(inArray(projects.id, projectIds));
    await tx.delete(folders).where(inArray(folders.id, folderIds));
  });
}
