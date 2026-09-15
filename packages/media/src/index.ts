/**
 * `@youandfriends/media`
 *
 * ffprobe validation, loudness analysis, derivative recipes, waveform peaks, and job contracts.
 *
 * Implementation arrives in task `060`. This package exists from the first commit so the
 * dependency direction described in `docs/ARCHITECTURE.md` §3 is enforced by the
 * workspace graph rather than by convention.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/media' as const;
