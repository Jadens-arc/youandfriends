/**
 * A/B switching between versions of one song (task `075`), as pure helpers.
 */

/** How far before the end a clamped switch lands, so the element is not handed its very end. */
export const CLAMP_MARGIN_SECONDS = 0.05;

/**
 * Where to start the other version: exactly where this one is — or, when this one is already past
 * the other's end, at the other's end, and say so.
 */
export function switchPosition(
  currentTime: number,
  targetDuration: number | null,
): { readonly startAt: number; readonly clamped: boolean } {
  if (targetDuration === null || currentTime < targetDuration) {
    return { startAt: Math.max(0, currentTime), clamped: false };
  }
  return { startAt: Math.max(0, targetDuration - CLAMP_MARGIN_SECONDS), clamped: true };
}

/** The next version in the list after `currentId`, wrapping; `null` with fewer than two. */
export function nextInCycle<T extends { readonly versionId: string }>(
  versions: readonly T[],
  currentId: string,
): T | null {
  if (versions.length < 2) return null;
  const index = versions.findIndex((version) => version.versionId === currentId);
  return versions[(index + 1) % versions.length] ?? null;
}

/**
 * The version to flip back to with the A/B key: the last *other* version that sounded, if it is
 * still one of this song's; otherwise the newest version that is not this one.
 */
export function alternateOf<T extends { readonly versionId: string }>(
  versions: readonly T[],
  currentId: string,
  lastOther: string | null,
): T | null {
  const previous = versions.find(
    (version) => version.versionId === lastOther && version.versionId !== currentId,
  );
  return previous ?? versions.find((version) => version.versionId !== currentId) ?? null;
}
