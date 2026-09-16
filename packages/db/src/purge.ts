import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';

import { folders, projects, songs } from './schema/index';
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
  readonly table: 'folders' | 'projects' | 'songs';
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
  /** Storage objects the candidates own, for the reaper. Empty until task `026`. */
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

  return {
    asOf: options.now,
    candidates: candidates.filter((candidate) =>
      approved.has(`${candidate.table}:${candidate.id}`),
    ),
    refusals,
    // **Still empty, and now that is a known gap, not a waiting one.** Task `026` created
    // `asset_versions` and `storage_objects`; this planner was not extended to reach them, so
    // hard-deleting a song cascades its versions away and leaves the storage rows behind as
    // orphans no later run can find. `assets` and `snapshots` also carry soft-delete columns
    // that nothing here scans or cascades to.
    //
    // Task `028` closes both. Registering the tables satisfied the `packages/authz` registry
    // — which checks that a table has a cross-tenant test, not that the purge knows about it
    // — so the guard I expected to catch this could not.
    storageKeys: [],
  };
}

/** What a run actually did. */
export interface PurgeResult {
  readonly plan: PurgePlan;
  readonly purged: { readonly folders: number; readonly projects: number; readonly songs: number };
  readonly storageObjectsDeleted: number;
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
  const projectIds = idsFor('projects');
  const folderIds = idsFor('folders');

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

  // Storage last. If the transaction rolls back after this, the objects are gone and the rows
  // remain — recoverable, because the rows still say what was lost. The other order loses the
  // record of what to look for.
  if (reaper !== null && plan.storageKeys.length > 0) {
    await reaper.delete(plan.storageKeys);
  }

  return {
    plan,
    purged: {
      folders: purgedFolders.length,
      projects: purgedProjects.length,
      songs: purgedSongs.length,
    },
    storageObjectsDeleted: reaper === null ? 0 : plan.storageKeys.length,
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
        `  DESTROY ${candidate.table.padEnd(8)} ${candidate.id}  ` +
          `workspace=${candidate.workspaceId}  deleted=${candidate.deletedAt.toISOString()}`,
      );
    }
  }

  if (plan.refusals.length > 0) {
    lines.push('', '  Held back:');
    for (const refusal of plan.refusals) {
      lines.push(`    KEEP    ${refusal.table.padEnd(8)} ${refusal.id}  — ${refusal.reason}`);
    }
  }

  lines.push(
    '',
    `  ${plan.candidates.length} to destroy, ${plan.refusals.length} held back, ` +
      `${plan.storageKeys.length} storage objects.`,
  );

  return lines.join('\n');
}
