import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { assets } from './assets';
import { storageObjects } from './storage-objects';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Upload sessions: what the server promised before any bytes arrived.
 *
 * **This table is the finalize check.** Every property recorded here is compared against the
 * real world when an upload completes — the key we issued, the ceiling we set, the owner we
 * authorized, the destination we approved. A finalize that trusted the client's claims instead
 * would be an arbitrary-object-attachment vulnerability: anyone could point a version at any
 * key in the bucket (`docs/THREAT_MODEL.md` T4).
 *
 * So the row is written once, by the server, and read at finalize. The client is never asked
 * what it uploaded; it is only asked *which session*, and everything else comes from here.
 */

export const uploadStateEnum = pgEnum('upload_state', [
  'pending',
  'completed',
  'aborted',
  'expired',
]);

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Who may finalize this. Checked at finalize, not only at creation.
     *
     * A session is not a bearer token: holding the id is not enough, because an id can be
     * guessed, logged, or shared. The finalizer must be the person the session was issued to.
     */
    ownerUserId: reference('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** The asset the finished version attaches to. Authorization is re-checked against it. */
    assetId: reference('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),

    /**
     * The key the server issued. **Never accepted from a client.**
     *
     * Finalize signs and completes against this value, so a client naming a different key is
     * simply not expressible in the protocol rather than being rejected by a check that might
     * one day be forgotten.
     */
    objectKey: text('object_key').notNull(),
    /** S3's handle for the multipart upload in flight. Null until the upload is created. */
    uploadId: text('upload_id'),

    /** The ceiling agreed at creation. A finished object larger than this is refused. */
    maxSizeBytes: bigint('max_size_bytes', { mode: 'number' }).notNull(),
    /** What the client said it was sending. A hint only — finalize reads magic bytes. */
    contentTypeHint: text('content_type_hint').notNull(),
    /** Part size the client must use, so part count is predictable from size. */
    partSizeBytes: integer('part_size_bytes').notNull(),
    /** What the client claims the whole object hashes to, for an end-to-end check. */
    expectedChecksumSha256: text('expected_checksum_sha256'),

    state: uploadStateEnum('state').notNull().default('pending'),
    /**
     * When this stops being usable.
     *
     * Not a convenience. An abandoned multipart upload accrues billed storage that nothing
     * references and no listing shows by default, so sessions expire and the sweep aborts them
     * (`docs/OPERATIONS.md` §2).
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** Set once the upload completes, so a replay can return the same answer. */
    storageObjectId: reference('storage_object_id').references(() => storageObjects.id, {
      onDelete: 'set null',
    }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('upload_sessions_id_workspace_key').on(table.id, table.workspaceId),
    // One session per key. The key is a fresh ULID per session, so a duplicate would mean two
    // sessions racing for one object — which is the shape of a confused-deputy bug.
    uniqueIndex('upload_sessions_object_key_key').on(table.objectKey),
    index('upload_sessions_workspace_state_idx').on(table.workspaceId, table.state),
    // The sweep's query: everything pending and past its time.
    index('upload_sessions_expiry_idx')
      .on(table.expiresAt)
      .where(sql`state = 'pending'`),
    check('upload_sessions_max_size_positive', sql`max_size_bytes > 0`),
    // S3 requires at least 5 MiB per part except the last. A smaller part size would produce a
    // multipart upload the store refuses to complete, discovered only at the end of a 2 GB
    // transfer.
    check('upload_sessions_part_size_minimum', sql`part_size_bytes >= 5242880`),
  ],
);

/**
 * The parts the client reports having uploaded.
 *
 * Recorded rather than trusted at finalize: the ETags are compared against what the store
 * itself lists, so a client cannot complete an upload with parts it never sent.
 */
export const uploadParts = pgTable(
  'upload_parts',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: reference('session_id')
      .notNull()
      .references(() => uploadSessions.id, { onDelete: 'cascade' }),
    partNumber: integer('part_number').notNull(),
    etag: text('etag').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // A part number is reported once per session. A second report is a re-upload, which
    // replaces rather than appends — two rows for one part would double the computed size.
    uniqueIndex('upload_parts_session_number_key').on(table.sessionId, table.partNumber),
    // Leads with the workspace, like every other tenant-owned table: a scoped read filters on
    // it first, and the schema test enforces the rule so a new table cannot quietly skip it.
    index('upload_parts_workspace_session_idx').on(table.workspaceId, table.sessionId),
    // S3 allows 1..10,000. A session claiming more is broken or hostile.
    check('upload_parts_number_range', sql`part_number between 1 and 10000`),
    check('upload_parts_size_positive', sql`size_bytes > 0`),
  ],
);
