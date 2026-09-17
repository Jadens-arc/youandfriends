import { and, eq, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';

import {
  assetVersions,
  assets,
  derivatives,
  mixVersions,
  folders,
  projects,
  snapshots,
  songs,
  storageObjects,
} from './schema/index';
import type { DirectDatabase } from './client';
import type { Transaction } from './transaction';

/**
 * The purge job: the only code in this repository that destroys user work.
 *
 * Everything here is written on the assumption that it will one day be run by someone tired,
 * at the wrong time, against the wrong database. So:
 *
 *   - It **plans before it acts.** A plan is a value that can be printed, reviewed, and
 *     thrown away. `--dry-run` produces the plan and stops.
 *   - It **refuses rather than guesses.** A row with a live reference is not purged, and the
 *     reason is reported rather than swallowed.
 *   - It **never purges an original with a live reference** (`docs/THREAT_MODEL.md` T8).
 *     Derivatives are regenerable and may go freely; originals may not, ever, while anything
 *     points at them.
 *
 * Storage deletion is an injected port rather than an import. `packages/db` must not depend
 * on `packages/storage` (`docs/ARCHITECTURE.md` §3), and the separation is useful beyond the
 * lint rule: the dry run needs to enumerate objects without any possibility of deleting one.
 */

/** One row the purge intends to destroy. */
export interface PurgeCandidate {
  readonly table: 'folders' | 'projects' | 'songs' | 'assets' | 'snapshots';
  readonly id: string;
  readonly workspaceId: string;
  readonly deletedAt: Date;
  readonly purgeAfter: Date;
}

/** A row that qualified on age but was held back, and why. */
export interface PurgeRefusal {
  readonly table: PurgeCandidate['table'];
  readonly id: string;
  readonly reason: string;
}

export interface PurgePlan {
  readonly asOf: Date;
  readonly candidates: readonly PurgeCandidate[];
  readonly refusals: readonly PurgeRefusal[];
  /**
   * The objects no surviving row will reference once this plan runs — ids for the row delete,
   * keys for the reaper.
   *
   * Computed by reachability rather than read from a column: `storage_objects` has no
   * `deleted_at` and no recovery window of its own, because an object is not a thing a person
   * sees or restores. It exists exactly as long as something points at it.
   */
  readonly storageObjects: readonly { readonly id: string; readonly key: string }[];
  /** The keys in {@link storageObjects}, for the reaper and the rendered plan. */
  readonly storageKeys: readonly string[];
}

/**
 * Deletes storage objects. Supplied by the caller; task `050` provides the R2 implementation.
 *
 * A `null` reaper means "there is no storage layer wired yet", which is different from "there
 * is nothing to delete" — {@link executePurge} refuses to proceed if a plan names storage keys
 * and no reaper was given, rather than deleting the rows and orphaning the objects.
 */
export interface ObjectReaper {
  delete(keys: readonly string[]): Promise<void>;
}

export interface PurgeOptions {
  readonly now: Date;
  /** Limit the blast radius of a single run. A purge that takes two nights is fine. */
  readonly limit?: number | undefined;
  /** Confine the run to one tenant, for a targeted recovery or an account closure. */
  readonly workspaceId?: string | undefined;
}

const DEFAULT_LIMIT = 500;

/**
 * Work out what is eligible, and what is held back.
 *
 * Reads only. Calling this can never destroy anything, which is what makes `--dry-run`
 * trustworthy rather than merely intended.
 */
export async function planPurge(db: DirectDatabase, options: PurgeOptions): Promise<PurgePlan> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidates: PurgeCandidate[] = [];
  const refusals: PurgeRefusal[] = [];

  const tables = [
    // Deepest first, which is also the order `executePurge` destroys them in.
    { name: 'assets' as const, table: assets },
    { name: 'snapshots' as const, table: snapshots },
    { name: 'songs' as const, table: songs },
    { name: 'projects' as const, table: projects },
    { name: 'folders' as const, table: folders },
  ];

  for (const { name, table } of tables) {
    const conditions = [
      isNotNull(table.deletedAt),
      isNotNull(table.purgeAfter),
      // Past its window, using the value recorded at delete time.
      lte(table.purgeAfter, options.now),
    ];
    if (options.workspaceId !== undefined) {
      conditions.push(eq(table.workspaceId, options.workspaceId));
    }

    const rows = await db
      .select({
        id: table.id,
        workspaceId: table.workspaceId,
        deletedAt: table.deletedAt,
        purgeAfter: table.purgeAfter,
      })
      .from(table)
      .where(and(...conditions))
      .limit(limit);

    for (const row of rows) {
      if (row.deletedAt === null || row.purgeAfter === null) continue;
      candidates.push({
        table: name,
        id: row.id,
        workspaceId: row.workspaceId,
        deletedAt: row.deletedAt,
        purgeAfter: row.purgeAfter,
      });
    }
  }

  // Referential checks.
  //
  // A parent is destroyed only when **every** descendant goes with it in the same run. Two
  // ways that can fail, and both were found by running the job against real rows rather than
  // by reading the code:
  //
  //  1. Checking only for *live* children misses one soft-deleted yesterday and still inside
  //     its window. `songs.project_id` cascades on delete, so purging the project would hard-
  //     delete a song the plan never named and its owner could still recover.
  //  2. Refusing a parent is not enough on its own — the refusal has to travel **upwards**.
  //     A held-back project whose folder is still purged leaves the project unfiled, moved by
  //     nobody. So refusals are resolved to a fixed point.
  //
  // This is the code `docs/THREAT_MODEL.md` T8 is about, and both failures were silent.
  // `relation` is the phrase the plan prints. "Filed in" and "nested in" and "belongs to" are
  // three different things to the person reading the output, and the output is the point.
  const relationships: {
    parent: string;
    child: string;
    childDeleted: boolean;
    relation: string;
  }[] = [];

  const projectIds = candidates.filter((c) => c.table === 'projects').map((c) => c.id);
  if (projectIds.length > 0) {
    const children = await db
      .select({ projectId: songs.projectId, id: songs.id, deletedAt: songs.deletedAt })
      .from(songs)
      .where(inArray(songs.projectId, projectIds));

    for (const song of children) {
      relationships.push({
        parent: `projects:${song.projectId}`,
        child: `songs:${song.id}`,
        childDeleted: song.deletedAt !== null,
        relation: 'still belongs to it',
      });
    }
  }

  // Files under a song or project. This is failure mode #1 above, recurring one level down:
  // `assets.song_id` and `assets.project_id` both cascade, so purging a song would hard-delete
  // an asset trashed yesterday and still inside its own recovery window — one the plan never
  // named and its owner could still restore.
  const songIds = candidates.filter((c) => c.table === 'songs').map((c) => c.id);
  if (songIds.length > 0) {
    const songAssets = await db
      .select({ songId: assets.songId, id: assets.id, deletedAt: assets.deletedAt })
      .from(assets)
      .where(inArray(assets.songId, songIds));

    for (const asset of songAssets) {
      if (asset.songId === null) continue;
      relationships.push({
        parent: `songs:${asset.songId}`,
        child: `assets:${asset.id}`,
        childDeleted: asset.deletedAt !== null,
        relation: 'is a file of it',
      });
    }
  }

  if (projectIds.length > 0) {
    const projectAssets = await db
      .select({ projectId: assets.projectId, id: assets.id, deletedAt: assets.deletedAt })
      .from(assets)
      .where(inArray(assets.projectId, projectIds));

    for (const asset of projectAssets) {
      if (asset.projectId === null) continue;
      relationships.push({
        parent: `projects:${asset.projectId}`,
        child: `assets:${asset.id}`,
        childDeleted: asset.deletedAt !== null,
        relation: 'is a file of it',
      });
    }

    const projectSnapshots = await db
      .select({ projectId: snapshots.projectId, id: snapshots.id, deletedAt: snapshots.deletedAt })
      .from(snapshots)
      .where(inArray(snapshots.projectId, projectIds));

    for (const snapshot of projectSnapshots) {
      relationships.push({
        parent: `projects:${snapshot.projectId}`,
        child: `snapshots:${snapshot.id}`,
        childDeleted: snapshot.deletedAt !== null,
        relation: 'is a snapshot of it',
      });
    }
  }

  // A mix is a song's view of an asset version, and `mix_versions.asset_version_id` is
  // `ON DELETE RESTRICT` — so destroying an asset whose version a mix still plays is refused by
  // Postgres, not cascaded. The right answer is to hold the asset back and say why: removing
  // that mix row would delete a user-visible row that was never in the trash.
  //
  // Missing this made every song with a mix unpurgeable — which is every song the product
  // produces — and the failure was a rolled-back transaction rather than a refusal, so a
  // single such row aborted the run for every tenant in it.
  const assetIds = candidates.filter((c) => c.table === 'assets').map((c) => c.id);
  if (assetIds.length > 0) {
    const mixes = await db
      .select({
        assetId: assetVersions.assetId,
        songId: mixVersions.songId,
        songDeletedAt: songs.deletedAt,
      })
      .from(mixVersions)
      .innerJoin(assetVersions, eq(assetVersions.id, mixVersions.assetVersionId))
      .innerJoin(songs, eq(songs.id, mixVersions.songId))
      .where(inArray(assetVersions.assetId, assetIds));

    for (const mix of mixes) {
      // The parent is the asset; the child is the song whose mix plays it. When that song is
      // going in the same run its mixes go with it, so the asset is free.
      relationships.push({
        parent: `assets:${mix.assetId}`,
        child: `songs:${mix.songId}`,
        childDeleted: mix.songDeletedAt !== null,
        relation: 'still plays it as a mix',
      });
    }
  }

  const folderIds = candidates.filter((c) => c.table === 'folders').map((c) => c.id);
  if (folderIds.length > 0) {
    // `projects.folder_id` is `on delete set null` rather than cascade, so a folder purge
    // strands rather than destroys — still wrong: the project silently becomes unfiled.
    const childProjects = await db
      .select({ folderId: projects.folderId, id: projects.id, deletedAt: projects.deletedAt })
      .from(projects)
      .where(inArray(projects.folderId, folderIds));

    for (const project of childProjects) {
      if (project.folderId === null) continue;
      relationships.push({
        parent: `folders:${project.folderId}`,
        child: `projects:${project.id}`,
        childDeleted: project.deletedAt !== null,
        relation: 'still filed in it',
      });
    }

    const childFolders = await db
      .select({ parentId: folders.parentId, id: folders.id, deletedAt: folders.deletedAt })
      .from(folders)
      .where(inArray(folders.parentId, folderIds));

    for (const folder of childFolders) {
      if (folder.parentId === null) continue;
      relationships.push({
        parent: `folders:${folder.parentId}`,
        child: `folders:${folder.id}`,
        childDeleted: folder.deletedAt !== null,
        relation: 'still nested in it',
      });
    }
  }

  const approved = new Set(candidates.map((candidate) => `${candidate.table}:${candidate.id}`));
  const refusedFor = new Map<string, string>();

  // Iterate until stable: refusing a project can newly disqualify its folder, which can
  // disqualify that folder's parent, and so on up the tree.
  for (let settled = false; !settled;) {
    settled = true;

    for (const { parent, child, childDeleted, relation } of relationships) {
      if (!approved.has(parent) || approved.has(child)) continue;

      approved.delete(parent);
      settled = false;

      const childName = child.split(':')[1] ?? child;
      const childKind = (child.split(':')[0] ?? '').replace(/s$/, '');
      refusedFor.set(
        parent,
        childDeleted
          ? `${childKind} ${childName} is in the trash and not yet purgeable`
          : `${childKind} ${childName} is live and ${relation}`,
      );
    }
  }

  for (const [key, reason] of refusedFor) {
    const [table, id] = key.split(':');
    refusals.push({ table: table as PurgeCandidate['table'], id: id ?? '', reason });
  }

  const approvedCandidates = candidates.filter((candidate) =>
    approved.has(`${candidate.table}:${candidate.id}`),
  );

  return {
    asOf: options.now,
    candidates: approvedCandidates,
    refusals,
    ...(await reachableStorage(db, approvedCandidates)),
  };
}

/**
 * The storage objects that will have nothing pointing at them once the plan runs.
 *
 * Reachability, not a column scan. A `storage_objects` row has no `deleted_at` and no recovery
 * window: an object is not something a person sees or restores, so it lives exactly as long as
 * something references it and no longer. The previous planner returned `[]` here, which meant
 * hard-deleting a song cascaded its versions away and left the bytes in the bucket with nothing
 * left to find them by — the guard in `executePurge` could not fire, because the list it checks
 * was always empty.
 *
 * Three kinds of row reference an object, and they are not alike:
 *
 *   - `asset_versions.storage_object_id` and `snapshots.storage_object_id` are `ON DELETE
 *     RESTRICT`. Postgres refuses the object delete if this function got it wrong, so a
 *     mistake there fails loudly instead of destroying bytes something still names.
 *   - `derivatives.storage_object_id` is `ON DELETE SET NULL`, so there is **no such net**. A
 *     derivative has its own object — a whole streaming rendition, paid for by the byte — and
 *     when its version is destroyed the row cascades away and those bytes were left in the
 *     bucket with nothing to find them by. Verified by running it, not by reading the code.
 *
 * A derivative never keeps an *original* alive: it is regenerable, and holding an original for
 * one would invert `docs/THREAT_MODEL.md` T8. It does keep **its own** object alive while the
 * derivative row survives, which is a different claim and the one applied below.
 */
async function reachableStorage(
  db: DirectDatabase,
  candidates: readonly PurgeCandidate[],
): Promise<Pick<PurgePlan, 'storageObjects' | 'storageKeys'>> {
  const idsFor = (table: PurgeCandidate['table']) =>
    candidates.filter((candidate) => candidate.table === table).map((candidate) => candidate.id);

  // Every asset that goes: named directly, or cascaded from a song or project that goes.
  const owners: SQL[] = [];
  const doomedSongs = idsFor('songs');
  const doomedProjects = idsFor('projects');
  const namedAssets = idsFor('assets');

  if (namedAssets.length > 0) owners.push(inArray(assets.id, namedAssets) as SQL);
  if (doomedSongs.length > 0) owners.push(inArray(assets.songId, doomedSongs) as SQL);
  if (doomedProjects.length > 0) owners.push(inArray(assets.projectId, doomedProjects) as SQL);

  const doomedAssets =
    owners.length === 0
      ? []
      : (
          await db
            .select({ id: assets.id })
            .from(assets)
            .where(or(...owners))
        ).map((row) => row.id);

  // Every snapshot that goes: named directly, or cascaded from a project that goes.
  const snapshotOwners: SQL[] = [];
  const namedSnapshots = idsFor('snapshots');
  if (namedSnapshots.length > 0) snapshotOwners.push(inArray(snapshots.id, namedSnapshots) as SQL);
  if (doomedProjects.length > 0) {
    snapshotOwners.push(inArray(snapshots.projectId, doomedProjects) as SQL);
  }

  const doomedSnapshots =
    snapshotOwners.length === 0
      ? []
      : (
          await db
            .select({ id: snapshots.id })
            .from(snapshots)
            .where(or(...snapshotOwners))
        ).map((row) => row.id);

  // Every version that goes with those assets. Versions carry no tombstone of their own — they
  // are immutable and belong to the asset (`docs/DESIGN.md`: originals are sacred).
  const doomedVersions =
    doomedAssets.length === 0
      ? []
      : await db
          .select({ id: assetVersions.id, objectId: assetVersions.storageObjectId })
          .from(assetVersions)
          .where(inArray(assetVersions.assetId, doomedAssets));

  const snapshotObjects =
    doomedSnapshots.length === 0
      ? []
      : await db
          .select({ id: snapshots.id, objectId: snapshots.storageObjectId })
          .from(snapshots)
          .where(inArray(snapshots.id, doomedSnapshots));

  // Derivatives of the doomed versions. They cascade away with the version, so their objects
  // become unreachable at the same moment the originals do.
  const doomedDerivatives =
    doomedVersions.length === 0
      ? []
      : await db
          .select({ id: derivatives.id, objectId: derivatives.storageObjectId })
          .from(derivatives)
          .where(
            inArray(
              derivatives.assetVersionId,
              doomedVersions.map((version) => version.id),
            ),
          );

  const objectIds = new Set<string>();
  for (const version of doomedVersions) objectIds.add(version.objectId);
  for (const derivative of doomedDerivatives) {
    // Null while the derivative is still queued or its job failed.
    if (derivative.objectId !== null) objectIds.add(derivative.objectId);
  }
  for (const snapshot of snapshotObjects) {
    // Null while a snapshot upload is still in flight.
    if (snapshot.objectId !== null) objectIds.add(snapshot.objectId);
  }

  if (objectIds.size === 0) return { storageObjects: [], storageKeys: [] };

  // The survivor check. An object stays if **anything** outside the doomed set still points at
  // it — the same bytes can back two versions once a copy exists, and reaping it would destroy
  // a file a live row still names.
  const doomedVersionIds = new Set(doomedVersions.map((version) => version.id));
  const doomedSnapshotIds = new Set(doomedSnapshots);
  const doomedDerivativeIds = new Set(doomedDerivatives.map((derivative) => derivative.id));
  const candidateIds = [...objectIds];

  const referencingVersions = await db
    .select({ objectId: assetVersions.storageObjectId, id: assetVersions.id })
    .from(assetVersions)
    .where(inArray(assetVersions.storageObjectId, candidateIds));

  const referencingSnapshots = await db
    .select({ objectId: snapshots.storageObjectId, id: snapshots.id })
    .from(snapshots)
    .where(inArray(snapshots.storageObjectId, candidateIds));

  const referencingDerivatives = await db
    .select({ objectId: derivatives.storageObjectId, id: derivatives.id })
    .from(derivatives)
    .where(inArray(derivatives.storageObjectId, candidateIds));

  const kept = new Set<string>();
  for (const derivative of referencingDerivatives) {
    // A surviving derivative keeps its own object, and `SET NULL` would not stop us reaping it
    // — it would just quietly blank the pointer and leave a derivative that plays silence.
    if (derivative.objectId !== null && !doomedDerivativeIds.has(derivative.id)) {
      kept.add(derivative.objectId);
    }
  }
  for (const version of referencingVersions) {
    if (!doomedVersionIds.has(version.id)) kept.add(version.objectId);
  }
  for (const snapshot of referencingSnapshots) {
    if (snapshot.objectId !== null && !doomedSnapshotIds.has(snapshot.id)) {
      kept.add(snapshot.objectId);
    }
  }

  const reapable = candidateIds.filter((id) => !kept.has(id));
  if (reapable.length === 0) return { storageObjects: [], storageKeys: [] };

  const rows = await db
    .select({ id: storageObjects.id, key: storageObjects.key })
    .from(storageObjects)
    .where(inArray(storageObjects.id, reapable));

  return { storageObjects: rows, storageKeys: rows.map((row) => row.key) };
}

/** What a run actually did. */
export interface PurgeResult {
  readonly plan: PurgePlan;
  readonly purged: {
    readonly folders: number;
    readonly projects: number;
    readonly songs: number;
    readonly assets: number;
    readonly snapshots: number;
  };
  readonly storageObjectsDeleted: number;
  /** Mix rows removed on the way, all of them belonging to songs in this run. */
  readonly mixVersionsDeleted: number;
  /**
   * The ids actually destroyed, per table.
   *
   * Not the same as `plan.candidates`: a row its owner restored between planning and running is
   * re-validated away and is **not** in here. The audit log is written from this, because an
   * event saying a row was purged when it still exists is worse than no event at all.
   */
  readonly destroyed: Readonly<Record<PurgeCandidate['table'], readonly string[]>>;
  /** The keys handed to the reaper — the objects whose rows really went. */
  readonly storageKeysDeleted: readonly string[];
}

/**
 * Destroy what the plan names, inside one transaction.
 *
 * The plan is re-validated against the database as it runs: a row that stopped qualifying
 * between planning and execution — restored by its owner in the meantime — is not purged.
 * A plan is a proposal, never a warrant.
 */
export async function executePurge(
  tx: Transaction,
  plan: PurgePlan,
  reaper: ObjectReaper | null,
): Promise<PurgeResult> {
  if (plan.storageKeys.length > 0 && reaper === null) {
    // Deleting the rows without the objects orphans paid-for storage that nothing will ever
    // reference again, and no later run can find it — the pointers are gone.
    throw new Error(
      `purge plan names ${plan.storageKeys.length} storage objects but no reaper was supplied`,
    );
  }

  const idsFor = (table: PurgeCandidate['table']) =>
    plan.candidates.filter((candidate) => candidate.table === table).map((c) => c.id);

  // Deepest first, so a foreign key never blocks a delete that the plan already approved.
  const songIds = idsFor('songs');
  const assetIds = idsFor('assets');
  const snapshotIds = idsFor('snapshots');
  const projectIds = idsFor('projects');
  const folderIds = idsFor('folders');

  // Mixes first. `mix_versions.asset_version_id` is `ON DELETE RESTRICT`, so deleting an asset
  // whose version a mix still plays is refused rather than cascaded — and the whole transaction
  // rolls back with it. The planner guarantees that every remaining mix belongs to a song in
  // this same run (see the mix relationship in `planPurge`), so clearing them here is removing
  // rows that were already going, in the order Postgres accepts.
  //
  // `songs.current_version_id` is `ON DELETE SET NULL ("current_version_id")`, so this blanks a
  // pointer on a song that is about to be destroyed anyway. Naming the column matters: a bare
  // `SET NULL` on that composite key would null `songs.id` too.
  const purgedMixes =
    songIds.length === 0
      ? []
      : await tx
          .delete(mixVersions)
          .where(inArray(mixVersions.songId, songIds))
          .returning({ id: mixVersions.id });

  const purgedAssets =
    assetIds.length === 0
      ? []
      : await tx
          .delete(assets)
          .where(and(inArray(assets.id, assetIds), isNotNull(assets.deletedAt)))
          .returning({ id: assets.id });

  const purgedSnapshots =
    snapshotIds.length === 0
      ? []
      : await tx
          .delete(snapshots)
          .where(and(inArray(snapshots.id, snapshotIds), isNotNull(snapshots.deletedAt)))
          .returning({ id: snapshots.id });

  const purgedSongs =
    songIds.length === 0
      ? []
      : await tx
          .delete(songs)
          .where(and(inArray(songs.id, songIds), isNotNull(songs.deletedAt)))
          .returning({ id: songs.id });

  const purgedProjects =
    projectIds.length === 0
      ? []
      : await tx
          .delete(projects)
          .where(and(inArray(projects.id, projectIds), isNotNull(projects.deletedAt)))
          .returning({ id: projects.id });

  const purgedFolders =
    folderIds.length === 0
      ? []
      : await tx
          .delete(folders)
          .where(and(inArray(folders.id, folderIds), isNotNull(folders.deletedAt)))
          .returning({ id: folders.id });

  // The `storage_objects` rows, now that the cascade has taken every `asset_versions` and
  // `snapshots` row that referenced them.
  //
  // Re-validated, exactly like the row deletes above. The plan's reachability was computed when
  // the plan was made, and a row its owner restored since then is still live — so each object is
  // deleted only if nothing references it *now*. For `asset_versions` and `snapshots` that is
  // belt and braces, because `RESTRICT` would refuse anyway. For `derivatives` it is the only
  // check there is: `SET NULL` would have blanked a surviving rendition's pointer and left it
  // claiming `complete` with nothing to re-queue it.
  const objectIds = plan.storageObjects.map((object) => object.id);
  const purgedObjects =
    objectIds.length === 0
      ? []
      : await tx
          .delete(storageObjects)
          .where(
            and(
              inArray(storageObjects.id, objectIds),
              sql`not exists (select 1 from ${assetVersions}
                    where ${assetVersions.storageObjectId} = ${storageObjects.id})`,
              sql`not exists (select 1 from ${snapshots}
                    where ${snapshots.storageObjectId} = ${storageObjects.id})`,
              sql`not exists (select 1 from ${derivatives}
                    where ${derivatives.storageObjectId} = ${storageObjects.id})`,
            ),
          )
          .returning({ id: storageObjects.id, key: storageObjects.key });

  // Storage last, and only the keys whose rows really went. Handing the reaper the *planned*
  // keys would delete bytes for a row that survived re-validation — silently, for a derivative.
  //
  // If the transaction rolls back after this, the objects are gone and the rows remain —
  // recoverable, because the rows still say what was lost. The other order loses the record of
  // what to look for.
  const storageKeysDeleted = purgedObjects.map((object) => object.key);
  if (reaper !== null && storageKeysDeleted.length > 0) {
    await reaper.delete(storageKeysDeleted);
  }

  return {
    plan,
    purged: {
      folders: purgedFolders.length,
      projects: purgedProjects.length,
      songs: purgedSongs.length,
      assets: purgedAssets.length,
      snapshots: purgedSnapshots.length,
    },
    mixVersionsDeleted: purgedMixes.length,
    storageObjectsDeleted: purgedObjects.length,
    storageKeysDeleted,
    destroyed: {
      folders: purgedFolders.map((row) => row.id),
      projects: purgedProjects.map((row) => row.id),
      songs: purgedSongs.map((row) => row.id),
      assets: purgedAssets.map((row) => row.id),
      snapshots: purgedSnapshots.map((row) => row.id),
    },
  };
}

/** A plan rendered for a human to read before approving it. */
export function describePlan(plan: PurgePlan): string {
  const lines = [`Purge plan as of ${plan.asOf.toISOString()}`, ''];

  if (plan.candidates.length === 0) {
    lines.push('  Nothing is past its recovery window.');
  } else {
    for (const candidate of plan.candidates) {
      lines.push(
        `  DESTROY ${candidate.table.padEnd(9)} ${candidate.id}  ` +
          `workspace=${candidate.workspaceId}  deleted=${candidate.deletedAt.toISOString()}`,
      );
    }
  }

  if (plan.refusals.length > 0) {
    lines.push('', '  Held back:');
    for (const refusal of plan.refusals) {
      lines.push(`    KEEP    ${refusal.table.padEnd(9)} ${refusal.id}  — ${refusal.reason}`);
    }
  }

  lines.push(
    '',
    `  ${plan.candidates.length} to destroy, ${plan.refusals.length} held back, ` +
      `${plan.storageKeys.length} storage objects.`,
  );

  return lines.join('\n');
}
