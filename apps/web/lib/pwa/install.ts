/**
 * What the platform will and will not let us offer.
 *
 * iOS has no `beforeinstallprompt` and no programmatic install. `docs/OPERATIONS.md` §9 and
 * `CLAUDE.md` §12 say the same thing about this: never claim a capability iOS does not
 * reliably support. So the honest surface is a button where a prompt exists and written
 * instructions where it does not — not a button that silently does nothing, which is the
 * common shape and is worse than no button at all.
 */

export type InstallAffordance = 'prompt' | 'ios-instructions' | 'already-installed' | 'none';

export interface PlatformFacts {
  readonly isIos: boolean;
  readonly isStandalone: boolean;
  readonly hasPrompt: boolean;
}

/** Read the platform from a user-agent string and display-mode result. Pure, so it is testable. */
export function readPlatform(
  userAgent: string,
  matchesStandalone: boolean,
  iosStandalone: boolean | undefined,
  hasPrompt: boolean,
): PlatformFacts {
  // iPadOS 13+ reports itself as a Mac, so `iPad` alone misses it. `Macintosh` with `Mobile`
  // is the tell that survives without touch-point sniffing.
  const isIos = /iPad|iPhone|iPod/.test(userAgent) || /Macintosh.*Mobile/.test(userAgent);
  return {
    // `display-mode: standalone` covers Android and desktop; iOS answers `navigator.standalone`.
    isIos,
    isStandalone: matchesStandalone || iosStandalone === true,
    hasPrompt,
  };
}

export function affordanceFor(facts: PlatformFacts): InstallAffordance {
  if (facts.isStandalone) return 'already-installed';
  if (facts.hasPrompt) return 'prompt';
  if (facts.isIos) return 'ios-instructions';
  // A browser that has not fired the event yet, or one that never will. Offering nothing is
  // honest; offering a dead button is not.
  return 'none';
}

/** The iOS steps, in the order they appear on the device. */
export const IOS_INSTALL_STEPS = [
  'Tap the Share button in Safari',
  'Scroll down and tap Add to Home Screen',
  'Tap Add',
] as const;
