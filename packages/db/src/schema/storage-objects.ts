import { bigint, index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { createdAt, id, workspaceId } from './columns';
import { workspaces } from './workspaces';

/**
 * A record of one object in bucket storage.
 *
 * The row is metadata; the bytes live in R2 (ADR 0001). Keeping them separate is what lets
 * the reconciliation in `docs/OPERATIONS.md` §5 work at all: without a row saying what should
 * be there, an orphaned object is indistinguishable from a file nobody has claimed yet.
 *
 * **Keys are opaque.** A key derived from a song title leaks the title to anyone who sees a
 * URL, and a presigned URL is seen by more people than the song is
 * (`docs/THREAT_MODEL.md` T3). Key construction lives in `packages/storage` (task `050`);
 * this table only records what was used.
 */
export const storageObjects = pgTable(
  'storage_objects',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    bucket: varchar('bucket', { length: 128 }).notNull(),
    /** Opaque, never a user path. */
    key: text('key').notNull(),
    /** `bigint` rather than `integer`: a 2 GB original overflows a 32-bit column. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Hex SHA-256. What reconciliation compares, and what proves the bytes never changed. */
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    contentType: varchar('content_type', { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // One row per object. Two rows for one key would make "is this orphaned?" unanswerable.
    uniqueIndex('storage_objects_bucket_key_key').on(table.bucket, table.key),
    uniqueIndex('storage_objects_id_workspace_key').on(table.id, table.workspaceId),
    index('storage_objects_workspace_idx').on(table.workspaceId, table.createdAt),
    // Reconciliation and de-duplication both start from the checksum.
    index('storage_objects_checksum_idx').on(table.workspaceId, table.checksumSha256),
  ],
);
