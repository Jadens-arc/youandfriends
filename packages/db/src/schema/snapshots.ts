import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, updatedAt, workspaceId } from './columns';
import { projects } from './projects';
import { softDeleteColumns } from './soft-delete';
import { storageObjects } from './storage-objects';
import { workspaces } from './workspaces';

export const snapshotSourceEnum = pgEnum('snapshot_source', ['browser_folder', 'mac_agent']);

/**
 * A captured folder: what a project directory looked like at one moment.
 *
 * Produced by the browser's folder upload or the macOS agent (task `110`). The bytes are one
 * ZIP in storage; this table and {@link snapshotEntries} record what went into it, so a person
 * can see the contents without downloading two gigabytes to find out.
 *
 * **Immutable once finalized.** A snapshot that can be edited afterwards is not a record of
 * anything — the point is that it says what was there, not what someone later wished had been.
 * The trigger in `migrations/0004_file_layer.sql` enforces it.
 */
export const snapshots = pgTable(
  'snapshots',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: reference('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * The Project Files asset whose version holds the ZIP (task `054`). Set at creation, before
     * the upload, so finalize can check that the upload it is handed is *this* snapshot's.
     *
     * The foreign key is hand-written in `migrations/0010_folder_snapshots.sql` as the composite
     * `(asset_id, workspace_id) → assets (id, workspace_id)`, so the asset is provably in the
     * snapshot's own workspace — the same pattern as the file layer's other parent references.
     */
    assetId: reference('asset_id'),
    source: snapshotSourceEnum('source').notNull(),
    name: text('name').notNull(),
    /** The ZIP. Null while the upload is still in flight. */
    storageObjectId: reference('storage_object_id').references(() => storageObjects.id, {
      onDelete: 'restrict',
    }),
    /** Null until finalized. Setting it seals the snapshot and its entries. */
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    createdBy: reference('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...softDeleteColumns(),
  },
  (table) => [
    uniqueIndex('snapshots_id_workspace_key').on(table.id, table.workspaceId),
    index('snapshots_workspace_project_idx').on(
      table.workspaceId,
      table.projectId,
      table.createdAt,
    ),
    index('snapshots_workspace_live_idx')
      .on(table.workspaceId, table.projectId)
      .where(sql`deleted_at is null`),
  ],
);

/**
 * One file inside a snapshot.
 *
 * `relativePath` is **untrusted input** — it comes from a user's filesystem, through a
 * browser's directory picker or a watcher on someone's Mac. A path with `..` in it, or an
 * absolute path, or a Windows drive letter, is a path-traversal attempt whether or not anyone
 * meant it that way (`docs/THREAT_MODEL.md` T4).
 *
 * The check constraint below rejects those **at the schema boundary**, not only where the
 * upload is parsed. There will be more than one writer — the browser path, the Mac agent, a
 * future import — and the constraint is the one place all of them pass through.
 */
export const snapshotEntries = pgTable(
  'snapshot_entries',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    snapshotId: reference('snapshot_id')
      .notNull()
      .references(() => snapshots.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Modification time from the source filesystem, not from us. */
    modifiedAt: timestamp('modified_at', { withTimezone: true }),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    /** True when an ignore rule excluded it from the ZIP but we still recorded that it existed. */
    ignored: boolean('ignored').notNull().default(false),
    /** Why an ignored entry was left out, as the sentence the person was shown (task `054`). */
    ignoreReason: text('ignore_reason'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('snapshot_entries_path_key').on(
      table.workspaceId,
      table.snapshotId,
      table.relativePath,
    ),
    index('snapshot_entries_snapshot_idx').on(table.workspaceId, table.snapshotId),

    /**
     * What a relative path may be.
     *
     * The first version of this rejected ASCII `..` and `.` segments between ASCII slashes,
     * which a security review got past seven different ways. Each one normalizes, decodes, or
     * splits into a traversal somewhere downstream:
     *
     *   `..／..／etc/passwd`      U+FF0F fullwidth solidus — NFKC-normalizes to `../../`
     *   `．．/etc/passwd`         U+FF0E fullwidth stop, and U+2024 one-dot leader, become `..`
     *   `%2e%2e/%2e%2e/x`        one `decodeURIComponent` away, and these end up in URLs
     *   `a.wav\n../secret.wav`   `(^|/)` treats no newline as a boundary; a line-wise reader sees `../`
     *   `café.wav` twice         NFC and NFD spellings of one macOS file defeat the unique index
     *   5000 characters          no bound at all
     *
     * So the rule is now an allow-list, not a deny-list: printable ASCII except the characters
     * that mean something to a path, already in NFC, bounded in length. Rejecting a legitimate
     * filename is a bug someone reports; accepting a traversal is one nobody does.
     */
    check(
      'snapshot_entries_relative_path_safe',
      sql`relative_path <> ''
        and length(relative_path) <= 1024
        and relative_path = normalize(relative_path, NFC)
        and relative_path ~ '^[ -~]+$'
        and relative_path !~ '^/'
        and relative_path !~ '^[A-Za-z]:'
        and relative_path !~ '\\\\'
        and relative_path !~ '(^|/)[[:space:]]*\\.\\.[[:space:]]*(/|$)'
        and relative_path !~ '(^|/)[[:space:]]*\\.[[:space:]]*(/|$)'
        and relative_path !~ '(^|/)[[:space:]]'
        and relative_path !~ '[[:space:]](/|$)'
        and relative_path !~ '//'
        and relative_path !~ '/$'
        and relative_path !~ '%[0-9A-Fa-f][0-9A-Fa-f]'
        and relative_path !~ '(^|/)~'`,
    ),
    check('snapshot_entries_size_non_negative', sql`size_bytes >= 0`),
  ],
);
