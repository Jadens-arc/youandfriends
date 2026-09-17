import { describe, expect, it } from 'vitest';

import { affordanceFor, IOS_INSTALL_STEPS, readPlatform } from '../install';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120';

describe('what the platform lets us offer', () => {
  it('offers the real prompt where the browser fires one', () => {
    expect(affordanceFor(readPlatform(ANDROID, false, undefined, true))).toBe('prompt');
  });

  it('offers written steps on iOS, never a button', () => {
    // iOS has no `beforeinstallprompt` and no programmatic install. A button here would do
    // nothing when tapped, which is worse than no button.
    expect(affordanceFor(readPlatform(IPHONE, false, false, false))).toBe('ios-instructions');
    expect(IOS_INSTALL_STEPS[0]).toMatch(/Share/);
  });

  it('recognises iPadOS, which reports itself as a Mac', () => {
    // `iPad` alone misses iPadOS 13+. Getting this wrong shows a desktop user nothing and an
    // iPad user nothing — the one case where the fallback is silently wrong on a real device.
    expect(readPlatform(IPADOS, false, false, false).isIos).toBe(true);
    expect(affordanceFor(readPlatform(IPADOS, false, false, false))).toBe('ios-instructions');
  });

  it('does not confuse a desktop Mac for an iPad', () => {
    expect(readPlatform(DESKTOP, false, undefined, false).isIos).toBe(false);
    expect(affordanceFor(readPlatform(DESKTOP, false, undefined, false))).toBe('none');
  });

  it('says nothing at all when already installed', () => {
    // Both signals, because iOS answers one and everything else answers the other.
    expect(affordanceFor(readPlatform(ANDROID, true, undefined, true))).toBe('already-installed');
    expect(affordanceFor(readPlatform(IPHONE, false, true, false))).toBe('already-installed');
  });

  it('prefers already-installed over every other answer', () => {
    // A prompt shown to someone who already installed it is the app not knowing where it is.
    expect(affordanceFor({ isIos: true, isStandalone: true, hasPrompt: true })).toBe(
      'already-installed',
    );
  });
});
