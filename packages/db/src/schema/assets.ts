import { ASSET_KINDS } from '@youandfriends/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { projects } from './projects';
import { softDeleteColumns } from './soft-delete';
import { songs } from './songs';
import { workspaces } from './workspaces';

export const assetKindEnum = pgEnum('asset_kind', ASSET_KINDS);

/**
 * A logical file: the thing a person names, moves, and re-uploads. Its bytes are
 * {@link import('./versions').assetVersions}.
 *
 * **There is exactly one Project Files area** (`docs/DESIGN.md` §2 and the amendment in §16).
 * Logic projects, MPC projects, ZIPs, MIDI, presets, and session notes all live here, and
 * they are organized by `folderPath` and `tags` — user-created structure, not product
 * structure. There is no Logic column and no MPC column, and none is to be added: the moment
 * the schema names a DAW, the product has an opinion about which DAWs exist.
 *
 * An asset hangs off a song or a project, never both and never neither. Artwork belongs to a
 * project; stems belong to a song.
 */
export const assets = pgTable(
  'assets',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    songId: reference('song_id').references(() => songs.id, { onDelete: 'cascade' }),
    projectId: reference('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    kind: assetKindEnum('kind').notNull(),
    name: text('name').notNull(),

    /**
     * Where inside Project Files the user filed it, as a normalized path such as
     * `/Sessions/2026/`. Empty means the root of the area.
     *
     * A string rather than a folder table: these folders are per-asset organization inside one
     * area, not a second hierarchy with its own permissions. Giving them rows would invite
     * grants on them, and `docs/DESIGN.md` §3 is explicit that grants target folders,
     * projects, and songs — not this.
     */
    folderPath: text('folder_path').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDeleteColumns(),
  },
  (table) => [
    uniqueIndex('assets_id_workspace_key').on(table.id, table.workspaceId),
    index('assets_workspace_song_idx').on(table.workspaceId, table.songId),
    index('assets_workspace_project_idx').on(table.workspaceId, table.projectId),
    index('assets_workspace_kind_idx').on(table.workspaceId, table.kind),
    index('assets_workspace_live_idx')
      .on(table.workspaceId, table.songId)
      .where(sql`deleted_at is null`),
    // Exactly one owner. Neither leaves the asset unreachable from any surface; both makes
    // "where does this live" a question with two answers.
    check('assets_one_owner', sql`num_nonnulls(song_id, project_id) = 1`),
    /**
     * Always bounded by slashes, so a prefix query cannot match a sibling with a longer name;
     * no traversal; no `.` segment either, because `/a/./b/` and `/a/b/` are one folder
     * written twice and the tree would show both. Same allow-list and bound as
     * `snapshot_entries` — one spelling rule for the whole product, not two that drift.
     */
    check(
      'assets_folder_path_normalized',
      sql`folder_path = ''
        or (length(folder_path) <= 1024
            and folder_path = normalize(folder_path, NFC)
            and folder_path ~ '^/([ -~]+/)*$'
            and folder_path !~ '(^|/)[[:space:]]*\\.\\.[[:space:]]*(/|$)'
            and folder_path !~ '(^|/)[[:space:]]*\\.[[:space:]]*(/|$)'
            and folder_path !~ '(^|/)[[:space:]]'
            and folder_path !~ '[[:space:]](/|$)'
            and folder_path !~ '%[0-9A-Fa-f][0-9A-Fa-f]')`,
    ),
  ],
);
