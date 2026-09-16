import { sql } from 'drizzle-orm';
import { index, uniqueIndex, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workStatusEnum, workspaceId } from './columns';
import { folders } from './folders';
import { softDeleteColumns } from './soft-delete';
import { workspaces } from './workspaces';

/**
 * A project: a body of work with a name, an artist, cover art, and songs.
 *
 * `folderId` is nullable — a project that has not been filed anywhere is a normal state, not
 * an error, and forcing an "Unfiled" folder into existence would make it appear in the tree.
 */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: reference('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    artist: text('artist'),
    /**
     * Cover art, as an asset reference. The foreign key lands in task `026` with the `assets`
     * table; adding the column now and the constraint then avoids a circular migration,
     * which is the trade the task notes call for.
     */
    coverAssetId: reference('cover_asset_id'),
    status: workStatusEnum('status').notNull().default('idea'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDeleteColumns(),
  },
  (table) => [
    // Workspace leads every index here: no query reads a project without a tenant in hand.
    index('projects_workspace_folder_idx').on(table.workspaceId, table.folderId),
    index('projects_workspace_status_idx').on(table.workspaceId, table.status),
    index('projects_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    uniqueIndex('projects_id_workspace_key').on(table.id, table.workspaceId),
    index('projects_workspace_live_idx')
      .on(table.workspaceId, table.folderId)
      .where(sql`deleted_at is null`),
  ],
);
