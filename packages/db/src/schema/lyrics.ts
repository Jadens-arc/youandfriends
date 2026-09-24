import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/** Raw bytes — the Yjs document state. */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/** A full-text search vector. Only ever generated, never written. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * One song's lyrics (task `080`, ADR 0003) — **Postgres is canonical; Liveblocks is transport.**
 *
 * Three projections of one document, written together on every save:
 *
 * - `document`: the canonical Tiptap JSON, validated by `lyricsDocumentSchema` before it lands.
 * - `plain_text`: derived from the document on every save, never authored, so search (task `045`)
 *   finds what is on the page. `search` is generated from it and GIN-indexed.
 * - `yjs_state`: the realtime layer's CRDT state (task `082`), so a room can be rebuilt from here.
 *
 * `version` is the optimistic-concurrency counter: a save names the version it started from, and
 * a save against any other version is a conflict, surfaced — never a silent overwrite.
 *
 * The song reference is composite, `(song_id, workspace_id)` → `songs (id, workspace_id)`,
 * hand-written in the migration like `loop_regions`'.
 */
export const lyricsDocuments = pgTable(
  'lyrics_documents',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    songId: reference('song_id').notNull(),
    document: jsonb('document').notNull(),
    plainText: text('plain_text').notNull().default(''),
    search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('simple', plain_text)`),
    yjsState: bytea('yjs_state'),
    version: integer('version').notNull().default(1),
    updatedBy: reference('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('lyrics_documents_song_key').on(table.workspaceId, table.songId),
    index('lyrics_documents_search_idx').using('gin', table.search),
    check('lyrics_documents_version_positive', sql`version >= 1`),
  ],
);
