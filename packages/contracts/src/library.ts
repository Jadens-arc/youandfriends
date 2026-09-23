import { z } from 'zod';

import {
  assetIdSchema,
  folderIdSchema,
  projectIdSchema,
  songIdSchema,
  uploadSessionIdSchema,
} from './ids';
import { workStatusSchema } from './work-status';
import { normalizeRelativePath } from './snapshots';

/**
 * Creating projects and songs (task `046`). One schema per form, shared by the dialog and the
 * route, so the two cannot disagree about what a valid name is.
 */

export const PROJECT_NAME_MAX = 200;
export const SONG_TITLE_MAX = 200;

const nameOf = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Give the ${label} a name.`)
    .max(max, `Keep the ${label}’s name under ${max} characters.`);

export const createProjectSchema = z.object({
  name: nameOf('project', PROJECT_NAME_MAX),
  artist: z
    .string()
    .trim()
    .max(PROJECT_NAME_MAX, `Keep the artist under ${PROJECT_NAME_MAX} characters.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  /** Where to file it. `null` or absent files it at the root. */
  folderId: folderIdSchema.nullable().optional(),
});
export type CreateProjectRequest = z.input<typeof createProjectSchema>;

export const createSongSchema = z.object({
  title: nameOf('song', SONG_TITLE_MAX),
});
export type CreateSongRequest = z.input<typeof createSongSchema>;

/** A tag: short, trimmed, no commas (so a list of them can be typed as one line). */
export const TAG_MAX = 40;
export const MAX_TAGS = 20;
export const tagSchema = z
  .string()
  .trim()
  .min(1, 'A tag needs a name.')
  .max(TAG_MAX, `Keep tags under ${TAG_MAX} characters.`)
  .refine((value) => !value.includes(','), { message: 'Tags cannot contain commas.' });

/** Case-insensitive de-duplication, keeping the first spelling — "Logic" and "logic" are one tag. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLocaleLowerCase('en');
    if (tag === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/**
 * The kinds a person can upload directly into a song or project (task `055`). Mixes go through
 * the version stack (`/api/songs/:id/versions`); voice notes belong to comments (task `093`).
 */
export const UPLOADABLE_KINDS = ['master', 'stem', 'sample', 'project_file', 'artwork'] as const;
export type UploadableKind = (typeof UPLOADABLE_KINDS)[number];

/** Kinds that belong to a song, and kinds that may belong to a project. */
export const SONG_ASSET_KINDS: readonly UploadableKind[] = [
  'master',
  'stem',
  'sample',
  'project_file',
];
export const PROJECT_ASSET_KINDS: readonly UploadableKind[] = ['project_file', 'artwork'];

/**
 * A Project Files folder as stored on `assets.folder_path`: `''` for the root, otherwise
 * `/A/B/`. Built from a relative path with the same allow-list as snapshot paths, so the two
 * cannot disagree about what a safe folder name is.
 */
export function toFolderPath(relative: string): string | null {
  const trimmed = relative.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return '';
  const result = normalizeRelativePath(trimmed);
  return result.ok ? `/${result.path}/` : null;
}

export const createAssetSchema = z
  .object({
    songId: songIdSchema.optional(),
    projectId: projectIdSchema.optional(),
    kind: z.enum(UPLOADABLE_KINDS),
    name: z.string().trim().min(1, 'Give the file a name.').max(255),
    /** A relative folder inside Project Files, e.g. `Sessions/2026`. */
    folder: z
      .string()
      .max(1000)
      .optional()
      .refine((value) => value === undefined || toFolderPath(value) !== null, {
        message: 'That folder name uses characters that can’t be stored yet.',
      }),
    tags: z.array(tagSchema).max(MAX_TAGS).optional(),
  })
  .refine((value) => (value.songId === undefined) !== (value.projectId === undefined), {
    message: 'A file belongs to a song or a project.',
  })
  .refine(
    (value) =>
      value.songId !== undefined
        ? SONG_ASSET_KINDS.includes(value.kind)
        : PROJECT_ASSET_KINDS.includes(value.kind),
    { message: 'That kind of file does not belong there.' },
  );
export type CreateAssetRequest = z.input<typeof createAssetSchema>;

export const recordAssetVersionSchema = z.object({ sessionId: uploadSessionIdSchema });

/**
 * Renaming, moving, and tagging a file in Project Files (task `057`). At least one field; each
 * validated with the same rules as upload.
 */
export const updateAssetSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the file a name.').max(255).optional(),
    folder: z
      .string()
      .max(1000)
      .optional()
      .refine((value) => value === undefined || toFolderPath(value) !== null, {
        message: 'That folder name uses characters that can’t be stored yet.',
      }),
    tags: z.array(tagSchema).max(MAX_TAGS).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.folder !== undefined || value.tags !== undefined,
    { message: 'Nothing to change.' },
  );
export type UpdateAssetRequest = z.input<typeof updateAssetSchema>;

/** Song notes: plain text, rendered escaped. */
export const SONG_NOTES_MAX = 5000;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/**
 * Editing a song's metadata inline (task `043`). Every field optional; at least one present. An
 * empty artist clears the song's own artist, falling back to its project's.
 */
export const updateSongSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Give the song a name.')
      .max(SONG_TITLE_MAX, `Keep the song’s name under ${SONG_TITLE_MAX} characters.`)
      .optional(),
    artist: optionalText(PROJECT_NAME_MAX, 'artist'),
    status: workStatusSchema.optional(),
    notes: optionalText(SONG_NOTES_MAX, 'notes'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change.',
  });
export type UpdateSongRequest = z.input<typeof updateSongSchema>;

export const updateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give the project a name.')
      .max(PROJECT_NAME_MAX, `Keep the project’s name under ${PROJECT_NAME_MAX} characters.`)
      .optional(),
    artist: optionalText(PROJECT_NAME_MAX, 'artist'),
    status: workStatusSchema.optional(),
    /** An artwork asset of this project, or `null` to clear the cover. */
    coverAssetId: assetIdSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change.',
  });
export type UpdateProjectRequest = z.input<typeof updateProjectSchema>;

/**
 * Each editable field's own rule, by name — what an inline editor validates one field with
 * (task `043`). The same schemas the whole-object update schemas are built from.
 */
export const METADATA_FIELD_SCHEMAS = {
  songTitle: z
    .string()
    .trim()
    .min(1, 'Give the song a name.')
    .max(SONG_TITLE_MAX, `Keep the song’s name under ${SONG_TITLE_MAX} characters.`),
  projectName: z
    .string()
    .trim()
    .min(1, 'Give the project a name.')
    .max(PROJECT_NAME_MAX, `Keep the project’s name under ${PROJECT_NAME_MAX} characters.`),
  artist: optionalText(PROJECT_NAME_MAX, 'artist'),
  notes: optionalText(SONG_NOTES_MAX, 'notes'),
} as const;
export type MetadataField = keyof typeof METADATA_FIELD_SCHEMAS;
