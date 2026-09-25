import { describe, expect, it } from 'vitest';

import { OPAQUE_CONTENT_TYPE, SERVABLE_CONTENT_TYPES, servableContentType } from './serving';

describe('which types an object may be served as', () => {
  it('serves allowlisted audio as itself', () => {
    for (const type of SERVABLE_CONTENT_TYPES) expect(servableContentType(type)).toBe(type);
    expect(servableContentType('Audio/MP4')).toBe('audio/mp4');
  });

  it('serves anything renderable, or unknown, as an opaque download', () => {
    for (const type of [
      'text/html',
      'text/html; charset=utf-8',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/xml',
      'application/javascript',
      'text/plain',
      'video/mp4',
      '',
      'audio/wav, text/html',
    ]) {
      expect(servableContentType(type)).toBe(OPAQUE_CONTENT_TYPE);
    }
    expect(servableContentType(null)).toBe(OPAQUE_CONTENT_TYPE);
  });

  it('never lets a parameter smuggle a renderable type through', () => {
    expect(servableContentType('audio/wav; x=1')).toBe('audio/wav');
    expect(servableContentType('text/html; audio/wav')).toBe(OPAQUE_CONTENT_TYPE);
  });
});
