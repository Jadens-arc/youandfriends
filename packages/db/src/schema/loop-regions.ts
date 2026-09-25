import { sql } from 'drizzle-orm';
import { check, integer, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';

import { id, reference, updatedAt, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * One person's loop region on one song (task `074`).
 *
 * Per user **and** per song: two collaborators looping different sections of the same song never
 * see each other's, and a region follows its song across versions rather than one mix. Read and
 * written only for the signed-in user, after `view` on the song.
 *
 * The song reference is composite — `(song_id, workspace_id)` against `songs (id, workspace_id)`,
 * hand-written in the migration — so a row can never pair one workspace with another's song.
 */
export const loopRegions = pgTable(
  'loop_regions',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    songId: reference('song_id').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('loop_regions_user_song_key').on(table.workspaceId, table.userId, table.songId),
    check('loop_regions_bounds', sql`start_ms >= 0 and end_ms > start_ms`),
  ],
);
