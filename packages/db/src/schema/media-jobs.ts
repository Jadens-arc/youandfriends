import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { processingStateEnum } from './versions';
import { workspaces } from './workspaces';

/**
 * One media-processing job per asset version (task `064`, ADR 0002).
 *
 * The row is the product's own record of the work, kept apart from whatever the queue remembers:
 * a queue that is unreachable, or that forgets a run, must not be able to make an upload look
 * finished. The row is written `queued` *before* anything is dispatched, and only the worker
 * that did the work moves it to `complete` — so an outage leaves a truthful `queued` behind, and
 * `ops:media:retry` can find it.
 *
 * **One row per asset version** is the idempotency key. A second enqueue of the same version
 * finds the first row instead of starting parallel work that would race to write derivatives.
 */
export const mediaJobs = pgTable(
  'media_jobs',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * The version this job processes. Its foreign key is composite — `(asset_version_id,
     * workspace_id)` against `asset_versions (id, workspace_id)`, hand-written in
     * `migrations/0016_media_jobs.sql` like the snapshots' asset reference — so a job can never
     * pair one workspace's row with another workspace's version.
     */
    assetVersionId: reference('asset_version_id').notNull(),
    state: processingStateEnum('state').notNull().default('queued'),
    /** Attempts the worker has *started*. Incremented on entry, so a crash still counts. */
    attempts: integer('attempts').notNull().default(0),
    /** The queue's id for the last dispatch, or null when nothing has taken the work yet. */
    runId: text('run_id'),
    /**
     * Why the last attempt, or the last dispatch, did not succeed. A sanitized message — never a
     * URL, a credential, or a tool's raw stderr (which carries file paths).
     */
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('media_jobs_asset_version_key').on(table.workspaceId, table.assetVersionId),
    // `ops:media:retry --failed` and the stuck-job query.
    index('media_jobs_unfinished_idx')
      .on(table.workspaceId, table.state)
      .where(sql`state <> 'complete'`),
    check('media_jobs_attempts_nonnegative', sql`attempts >= 0`),
  ],
);
