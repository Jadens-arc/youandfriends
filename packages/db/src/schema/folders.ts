import { sql } from 'drizzle-orm';
import { type AnyPgColumn, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { softDeleteColumns } from './soft-delete';
import { workspaces } from './workspaces';

/**
 * Nestable folders, with a materialized path.
 *
 * `path` holds the ancestor chain as `/<root id>/<child id>/…/<own id>/`, so "everything
 * under this folder" is a prefix scan rather than a recursive CTE per request. That matters
 * because task `022` walks the ancestor chain on *every* permission check — the difference
 * between a fast product and a slow one is decided here, not there.
 *
 * Three things are enforced by the database rather than by application code, because
 * application-only checks lose races:
 *
 *   - `path` is **computed** by a trigger from the parent's path, so it cannot be set wrong.
 *   - A folder cannot become its own ancestor; the trigger rejects it.
 *   - Moving a folder rewrites the whole subtree, inside the caller's transaction.
 *
 * The trigger bodies live in the migration alongside the table, because they are part of the
 * table's contract rather than an optimisation applied to it. See
 * `migrations/0000_core_schema.sql`.
 */
export const folders = pgTable(
  'folders',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Null for a root folder. Self-reference, so the type has to be named explicitly. */
    parentId: reference('parent_id').references((): AnyPgColumn => folders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    /**
     * Maintained by trigger. Writes to this column from application code are overwritten on
     * insert and on move, which is the intent: there is one authority for it.
     */
    path: text('path').notNull().default(''),
    /**
     * Derived from `path`, stored, and never written by hand — one fewer column that can
     * disagree with another.
     */
    depth: integer('depth').generatedAlwaysAs(
      sql`(length(path) - length(replace(path, '/', ''))) - 2`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDeleteColumns(),
  },
  (table) => [
    // Two folders with the same name under the same parent are indistinguishable in the UI.
    // `parent_id` is nullable, and Postgres treats NULLs as distinct in a unique index, so
    // root-level names are covered by the partial index below.
    uniqueIndex('folders_parent_name_key')
      .on(table.workspaceId, table.parentId, table.name)
      .where(sql`parent_id is not null`),
    uniqueIndex('folders_root_name_key')
      .on(table.workspaceId, table.name)
      .where(sql`parent_id is null`),
    // The prefix scan. `text_pattern_ops` is what makes `path LIKE '/a/b/%'` use the index;
    // the default collation-aware operator class does not.
    index('folders_workspace_path_idx').using(
      'btree',
      table.workspaceId,
      sql`path text_pattern_ops`,
    ),
    index('folders_workspace_parent_idx').on(table.workspaceId, table.parentId),
    // The default query is "live rows in this workspace". A partial index keeps it from
    // scanning tombstones, which accumulate for the whole retention window.
    index('folders_workspace_live_idx')
      .on(table.workspaceId, table.parentId)
      .where(sql`deleted_at is null`),
  ],
);
