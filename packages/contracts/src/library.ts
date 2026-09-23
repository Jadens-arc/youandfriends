import { z } from 'zod';

import { folderIdSchema } from './ids';

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
