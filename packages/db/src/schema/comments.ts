import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * A conversation on a song (task `090`): a thread, anchored somewhere, holding comments.
 *
 * The anchor is a **discriminator designed once, here**, for all three kinds, so later tasks add
 * behaviour rather than columns:
 *
 * - `general` — about the song as a whole. No anchor fields.
 * - `timestamp` — a moment in one version (task `091`): `anchor_version_id` and `anchor_ms`.
 *   The version is not a foreign key on purpose: a restricting key would make a version with
 *   comments unpurgeable, and a cascading one would silently delete conversation. The service
 *   checks the version belongs to the song when the thread is made.
 * - `lyric` — a range of the lyrics (task `092`): `anchor_lyric`, identity-based like lyric
 *   timestamps, never character offsets.
 *
 * Resolution belongs to the thread. The song reference is composite, hand-written in the
 * migration, as for every song-owned table.
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    songId: reference('song_id').notNull(),
    anchorKind: text('anchor_kind', { enum: ['general', 'timestamp', 'lyric'] }).notNull(),
    anchorVersionId: reference('anchor_version_id'),
    anchorMs: integer('anchor_ms'),
    anchorLyric: jsonb('anchor_lyric'),
    createdBy: reference('created_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: reference('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    /** The thread's last activity: a comment, an edit, a resolution. Lists sort by it. */
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('comment_threads_id_workspace_key').on(table.id, table.workspaceId),
    index('comment_threads_song_idx').on(table.workspaceId, table.songId, table.updatedAt),
    check(
      'comment_threads_anchor_kind_known',
      sql`anchor_kind in ('general', 'timestamp', 'lyric')`,
    ),
    check(
      'comment_threads_anchor_shape',
      sql`(anchor_kind = 'general' and anchor_version_id is null and anchor_ms is null and anchor_lyric is null)
        or (anchor_kind = 'timestamp' and anchor_version_id is not null and anchor_ms is not null and anchor_ms >= 0 and anchor_lyric is null)
        or (anchor_kind = 'lyric' and anchor_lyric is not null and anchor_version_id is null and anchor_ms is null)`,
    ),
    // Nobody resolves without a moment. (The resolver may later be gone — a deleted account.)
    check('comment_threads_resolver_has_time', sql`resolved_by is null or resolved_at is not null`),
  ],
);

/**
 * One message in a thread. Plain text, never HTML — rendered through React's escaping.
 *
 * Deleting a comment **tombstones** it: the words are erased and `tombstoned_at` set, but the row
 * stays, so a thread whose first comment was deleted still reads as a conversation. Tombstones are
 * their own columns rather than the trash's `deleted_at`: a deleted comment is not in the trash
 * and cannot be restored — its words are gone.
 */
export const comments = pgTable(
  'comments',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    threadId: reference('thread_id').notNull(),
    authorId: reference('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    /**
     * A voice note (task `093`): the `voice_note` asset holding the recording. Its words are the
     * audio, so a comment may be a voice note with no text. Composite with the workspace in the
     * migration; not cascading — deleting the comment trashes the asset instead.
     */
    voiceNoteAssetId: reference('voice_note_asset_id'),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    tombstonedBy: reference('tombstoned_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    // The composite target mentions and reactions reference (task `094`).
    uniqueIndex('comments_id_workspace_key').on(table.id, table.workspaceId),
    index('comments_thread_idx').on(table.workspaceId, table.threadId, table.createdAt),
    // One recording, one comment: two comments racing to claim a voice note cannot both win.
    uniqueIndex('comments_voice_note_key')
      .on(table.voiceNoteAssetId)
      .where(sql`voice_note_asset_id is not null`),
    check('comments_body_length', sql`length(body) <= 5000`),
    check('comments_tombstone_erases', sql`tombstoned_at is null or body = ''`),
    check(
      'comments_live_has_words',
      sql`tombstoned_at is not null or length(trim(body)) > 0 or voice_note_asset_id is not null`,
    ),
    check(
      'comments_tombstone_drops_voice',
      sql`tombstoned_at is null or voice_note_asset_id is null`,
    ),
  ],
);

/**
 * Who a comment mentions (task `094`) — and only those it could reach: people who could see the
 * song when it was written. Someone mentioned without access gets no row, no notification, and no
 * access; the author is told instead. A mention is never an invitation.
 *
 * The body carries the reference (`<@USERID>`); this row is what notifications and "mentions of
 * me" read, so neither has to parse text. The comment reference is composite with the workspace,
 * cascading, in the migration.
 */
export const commentMentions = pgTable(
  'comment_mentions',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    commentId: reference('comment_id').notNull(),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('comment_mentions_comment_user_key').on(table.commentId, table.userId),
    index('comment_mentions_user_idx').on(table.workspaceId, table.userId),
  ],
);

/** A reaction to a comment (task `094`): one of a fixed set, once per person per reaction. */
export const commentReactions = pgTable(
  'comment_reactions',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    commentId: reference('comment_id').notNull(),
    userId: reference('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reaction: text('reaction', {
      enum: ['thumbs_up', 'heart', 'fire', 'laugh', 'party', 'eyes'],
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('comment_reactions_once_key').on(table.commentId, table.userId, table.reaction),
    index('comment_reactions_comment_idx').on(table.workspaceId, table.commentId),
    check(
      'comment_reactions_known',
      sql`reaction in ('thumbs_up', 'heart', 'fire', 'laugh', 'party', 'eyes')`,
    ),
  ],
);
