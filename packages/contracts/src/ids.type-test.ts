/**
 * Type-level tests for the ID brand.
 *
 * The brand exists only in the type system, so no runtime test can prove it works. These
 * assertions run under `tsc --noEmit`, which is already a release-check gate.
 *
 * The mechanism is `@ts-expect-error`: it suppresses an error that must be there. If the
 * brand ever stops distinguishing entity types, the expected error disappears, TypeScript
 * reports the directive as unused, and `pnpm typecheck` fails. A guard that fails when the
 * thing it guards stops working — rather than one that quietly passes.
 */

import {
  projectIdSchema,
  songIdSchema,
  workspaceIdSchema,
  type ProjectId,
  type SongId,
  type WorkspaceId,
} from './ids';

const SAMPLE = '01J8XKQ2M3N4P5R6S7T8V9W0XY';

const songId: SongId = songIdSchema.parse(SAMPLE);
const projectId: ProjectId = projectIdSchema.parse(SAMPLE);
const workspaceId: WorkspaceId = workspaceIdSchema.parse(SAMPLE);

/** A SongId must not be assignable to a ProjectId. */
// @ts-expect-error — distinct entity brands must not be interchangeable
export const songIsNotProject: ProjectId = songId;

/** …and the reverse. */
// @ts-expect-error — distinct entity brands must not be interchangeable
export const projectIsNotSong: SongId = projectId;

/** A WorkspaceId must not be assignable to a SongId. */
// @ts-expect-error — distinct entity brands must not be interchangeable
export const workspaceIsNotSong: SongId = workspaceId;

/** A bare string must not be assignable to a branded ID without parsing. */
// @ts-expect-error — an unparsed string has not been validated
export const rawStringIsNotSongId: SongId = SAMPLE;

/** A branded ID IS assignable to string, so it stays usable in ordinary string contexts. */
export const songIdIsAString: string = songId;

/** The same brand is assignable to itself. */
export const sameBrandAssigns: SongId = songId;

/** A function taking one brand must reject another. */
function takesSongId(id: SongId): SongId {
  return id;
}
export const acceptsCorrectBrand = takesSongId(songId);
// @ts-expect-error — a ProjectId is not a SongId
export const rejectsWrongBrand = takesSongId(projectId);
