/**
 * `@youandfriends/media`
 *
 * ffprobe validation, loudness analysis, derivative recipes, waveform peaks, and job contracts.
 *
 * Most of that arrives in task `060`. Magic-byte content typing landed early, in task `051`,
 * because finalize cannot record a content type without it and finalize is not a place to
 * trust the client. This package exists from the first commit so the dependency direction
 * described in `docs/ARCHITECTURE.md` §3 is enforced by the workspace graph rather than by
 * convention.
 */

export { hintDisagrees, sniffContentType, SNIFF_PREFIX_BYTES, UNKNOWN_CONTENT_TYPE } from './sniff';

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/media' as const;
