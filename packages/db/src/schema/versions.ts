import { PROCESSING_STATES } from '@youandfriends/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, id, reference, workspaceId } from './columns';
import { assets } from './assets';
import { songs } from './songs';
import { storageObjects } from './storage-objects';
import { workspaces } from './workspaces';

export const processingStateEnum = pgEnum('processing_state', PROCESSING_STATES);

/**
 * Audio analysis, produced by the media pipeline from the uploaded bytes.
 *
 * Deliberately **not** covered by the immutability trigger below. These are *derived* — an
 * ffprobe pass that failed and was retried must be able to write its answer, and a better
 * loudness algorithm must be able to re-run over old files. What is immutable is the bytes
 * and what identifies them; what we have learned about those bytes is not.
 */
const audioMetadata = () => ({
  durationMs: integer('duration_ms'),
  codec: text('codec'),
  channels: integer('channels'),
  sampleRateHz: integer('sample_rate_hz'),
  bitDepth: integer('bit_depth'),
  /** Integrated loudness, LUFS. Negative. */
  integratedLufs: real('integrated_lufs'),
  /** True peak, dBTP. */
  truePeakDb: real('true_peak_db'),
  processingState: processingStateEnum('processing_state').notNull().default('queued'),
  processingError: text('processing_error'),
});

/**
 * One immutable upload of an asset.
 *
 * **Originals are sacred.** A new upload always creates a row here; nothing ever overwrites
 * one. That is enforced by a database trigger, not by convention — see
 * `migrations/0004_file_layer.sql`. The trigger rejects changes to the columns that identify
 * *which bytes these are*; the analysis columns above stay writable, because they describe
 * the bytes rather than being them.
 */
export const assetVersions = pgTable(
  'asset_versions',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: reference('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** 1-based, ordered per asset. */
    versionNumber: integer('version_number').notNull(),
    storageObjectId: reference('storage_object_id')
      .notNull()
      // `restrict`: the object record must not vanish out from under a version that still
      // claims it. `planPurge` computes which objects nothing will reference and `executePurge`
      // removes the versions first, so this constraint is the check on that reasoning rather
      // than an obstacle to it — a plan that got reachability wrong raises here.
      .references(() => storageObjects.id, { onDelete: 'restrict' }),
    uploadedBy: reference('uploaded_by'),
    note: text('note'),
    /** The uploader's own filename, from the session (task `056`). Display and download only. */
    originalFilename: text('original_filename'),
    ...audioMetadata(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('asset_versions_asset_number_key').on(
      table.workspaceId,
      table.assetId,
      table.versionNumber,
    ),
    uniqueIndex('asset_versions_id_workspace_key').on(table.id, table.workspaceId),
    index('asset_versions_workspace_asset_idx').on(table.workspaceId, table.assetId),
    index('asset_versions_storage_object_idx').on(table.storageObjectId),
    // The media pipeline's own queue query.
    index('asset_versions_processing_idx')
      .on(table.workspaceId, table.processingState)
      .where(sql`processing_state <> 'complete'`),
    check('asset_versions_number_positive', sql`version_number >= 1`),
  ],
);

/**
 * The version stack under a song: the mixes, newest last.
 *
 * Separate from `asset_versions` because a mix is a *product* concept — it is what the player
 * plays and what A/B switches between — while an asset version is a *file* concept. A stem
 * has versions and is never a mix; a mix points at the asset version holding its audio.
 */
export const mixVersions = pgTable(
  'mix_versions',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    songId: reference('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    assetVersionId: reference('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'restrict' }),
    uploadedBy: reference('uploaded_by'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('mix_versions_song_number_key').on(
      table.workspaceId,
      table.songId,
      table.versionNumber,
    ),
    /**
     * The target of `songs.current_version_id`'s composite foreign key.
     *
     * `id` is already unique on its own; this pair exists so the songs table can reference
     * `(id, song_id)` and have the database guarantee that a song's current version belongs
     * to *that song*. A trigger could check the same thing and would be one more thing that
     * can be dropped, disabled, or raced.
     */
    uniqueIndex('mix_versions_id_song_key').on(table.id, table.songId),
    // One mix per asset version (task `056`): what makes recording a finished upload as a mix
    // idempotent. A replay finds the mix version the first call made instead of stacking the
    // same bytes twice.
    uniqueIndex('mix_versions_asset_version_key').on(table.workspaceId, table.assetVersionId),
    index('mix_versions_workspace_song_idx').on(
      table.workspaceId,
      table.songId,
      table.versionNumber,
    ),
    check('mix_versions_number_positive', sql`version_number >= 1`),
  ],
);

export const derivativeKindEnum = pgEnum('derivative_kind', [
  'streaming_audio',
  'waveform_peaks',
  'thumbnail',
]);

/**
 * Regenerable output produced from a version: the AAC stream (ADR 0004), the waveform peaks,
 * a thumbnail.
 *
 * Several rows per version are allowed by design, not by accident. An Opus derivative
 * (deferred `205`) and HLS variants (deferred `206`) become new rows rather than a migration —
 * and the purge job may destroy any of these freely, because every one can be made again from
 * an original that cannot.
 */
export const derivatives = pgTable(
  'derivatives',
  {
    id: id(),
    workspaceId: workspaceId().references(() => workspaces.id, { onDelete: 'cascade' }),
    assetVersionId: reference('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    kind: derivativeKindEnum('kind').notNull(),
    /** A label such as `aac-192k`, so a second derivative of the same kind is addressable. */
    variant: text('variant').notNull().default('default'),
    storageObjectId: reference('storage_object_id').references(() => storageObjects.id, {
      onDelete: 'set null',
    }),
    processingState: processingStateEnum('processing_state').notNull().default('queued'),
    processingError: text('processing_error'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('derivatives_version_kind_variant_key').on(
      table.workspaceId,
      table.assetVersionId,
      table.kind,
      table.variant,
    ),
    index('derivatives_workspace_version_idx').on(table.workspaceId, table.assetVersionId),
    index('derivatives_processing_idx')
      .on(table.workspaceId, table.processingState)
      .where(sql`processing_state <> 'complete'`),
  ],
);

/**
 * `songs.current_version_id`, completed.
 *
 * Task `021` left the column as a forward reference with no constraint, to avoid a circular
 * migration. The constraint lands in `migrations/0004_file_layer.sql` as hand-written DDL
 * rather than here, because the pair it needs — `(current_version_id, id)` referencing
 * `mix_versions (id, song_id)` — would require `songs.ts` to import `versions.ts`, which
 * already imports `songs.ts`.
 *
 * The pair is the point. A plain `current_version_id -> mix_versions.id` would allow a song
 * to point at another song's version; this makes "a song's current version is a version of
 * that song" a fact the database enforces rather than an invariant the application maintains.
 */
export const SONG_CURRENT_VERSION_CONSTRAINT = 'songs_current_version_belongs_to_song' as const;
