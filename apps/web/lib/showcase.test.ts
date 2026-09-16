import { describe, expect, it } from 'vitest';

import { isShowcaseEnabled, SHOWCASE_PAGE_EXTENSION, SHOWCASE_PATH } from './showcase';

describe('isShowcaseEnabled', () => {
  it('is on in development', () => {
    expect(isShowcaseEnabled({ NODE_ENV: 'development' })).toBe(true);
  });

  it('is on in test, so the showcase can be asserted', () => {
    expect(isShowcaseEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('is off in production', () => {
    expect(isShowcaseEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is on in a preview deployment, where NODE_ENV is production', () => {
    // The two checks are not interchangeable: Vercel builds previews in production mode.
    expect(isShowcaseEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })).toBe(true);
  });

  it('is off in a production deployment', () => {
    expect(isShowcaseEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'production' })).toBe(false);
  });

  it('defaults to off when nothing says otherwise about production', () => {
    expect(isShowcaseEnabled({ NODE_ENV: 'production', VERCEL_ENV: undefined })).toBe(false);
  });

  it('names the path and the extension the gate depends on', () => {
    expect(SHOWCASE_PATH).toBe('/_showcase');
    expect(SHOWCASE_PAGE_EXTENSION).toBe('dev.tsx');
  });
});
