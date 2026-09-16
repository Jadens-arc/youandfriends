import { sql } from 'drizzle-orm';
import { index, uniqueIndex, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workStatusEnum, workspaceId } from './columns';
import { projects } from './projects';
import { softDeleteColumns } from './soft-delete';
import { workspaces } from './workspaces';

/**
 * A song, belonging to a project, with a stack of mix versions behind it.
 *
 * `currentVersionId` points at the version that plays by default. It is a **forward
 * reference**: `mix_versions` arrives in task `026`, and the foreign key is added there. A
 * constraint now would mean a circular migration, which the task notes rule out.
 *
 * The pointer is denormalised on purpose. "Which version is current" is read on every song
 * card, every player load, and every share resolution; deriving it from an ordered scan of
 * versions would put a sort on the hottest read in the product.
 */
export const songs = pgTable(
  'songs',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: reference('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Of the current version. Null until a version has been analysed (task `064`). */
    durationMs: integer('duration_ms'),
    status: workStatusEnum('status').notNull().default('idea'),
    currentVersionId: reference('current_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDeleteColumns(),
  },
  (table) => [
    index('songs_workspace_project_idx').on(table.workspaceId, table.projectId),
    index('songs_workspace_status_idx').on(table.workspaceId, table.status),
    // "Recently changed", which is the library's default ordering (docs/DESIGN.md §10).
    index('songs_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    // The target of every composite tenant foreign key that points at a song. `id` is already
    // unique; this pair is what lets a child row prove its parent is in the same workspace.
    uniqueIndex('songs_id_workspace_key').on(table.id, table.workspaceId),
    index('songs_workspace_live_idx')
      .on(table.workspaceId, table.projectId)
      .where(sql`deleted_at is null`),
    // The purge job's own query: what is past its window, anywhere.
    index('songs_purge_after_idx')
      .on(table.purgeAfter)
      .where(sql`deleted_at is not null`),
  ],
);
