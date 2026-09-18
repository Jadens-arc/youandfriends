import { describe, expect, it } from 'vitest';

import {
  hintDisagrees,
  sniffContentType,
  SNIFF_PREFIX_BYTES,
  UNKNOWN_CONTENT_TYPE,
} from './sniff.js';

/** A prefix built from a literal header, padded to what the driver would actually hand over. */
function prefix(header: readonly (number | string)[]): Uint8Array {
  const bytes: number[] = [];
  for (const part of header) {
    if (typeof part === 'number') bytes.push(part);
    else for (const char of part) bytes.push(char.charCodeAt(0));
  }
  while (bytes.length < SNIFF_PREFIX_BYTES) bytes.push(0);
  return Uint8Array.from(bytes);
}

/** A real 44-byte WAV header, the way a bounce from any DAW starts. */
const WAV = prefix(['RIFF', 0x24, 0x08, 0x00, 0x00, 'WAVEfmt ']);

describe('sniffing a content type from the bytes', () => {
  it.each([
    ['WAV', WAV, 'audio/wav'],
    ['AIFF', prefix(['FORM', 0x00, 0x00, 0x08, 0x24, 'AIFFCOMM']), 'audio/aiff'],
    ['compressed AIFF', prefix(['FORM', 0x00, 0x00, 0x08, 0x24, 'AIFCFVER']), 'audio/aiff'],
    ['FLAC', prefix(['fLaC', 0x00, 0x00, 0x00, 0x22]), 'audio/flac'],
    ['CAF', prefix(['caff', 0x00, 0x01, 0x00, 0x00]), 'audio/x-caf'],
    ['MP3 with an ID3 tag', prefix(['ID3', 0x04, 0x00, 0x00]), 'audio/mpeg'],
    ['MP3 with no tag at all', prefix([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg'],
    ['M4A', prefix([0x00, 0x00, 0x00, 0x20, 'ftypM4A ']), 'audio/mp4'],
    ['MP4', prefix([0x00, 0x00, 0x00, 0x18, 'ftypmp42']), 'video/mp4'],
    ['OGG', prefix(['OggS', 0x00, 0x02]), 'audio/ogg'],
    ['a zipped project', prefix(['PK', 0x03, 0x04, 0x14, 0x00]), 'application/zip'],
    ['an empty zip', prefix(['PK', 0x05, 0x06]), 'application/zip'],
  ])('reads %s', (_label, bytes, expected) => {
    expect(sniffContentType(bytes)).toBe(expected);
  });

  it('does not call every file beginning "PK" a zip', () => {
    // The signature is four bytes. It was written into the source as *literal* control
    // characters, which `grep` and diffs render as a bare `'PK'` — a security review and I each
    // read a two-byte match that was not there. The bytes were always right; nothing pinned it.
    // This does, and the table now spells the escapes out.
    expect(sniffContentType(prefix(['PK', 0x99, 0x99]))).toBe(UNKNOWN_CONTENT_TYPE);
    expect(sniffContentType(prefix(['PKZIP']))).toBe(UNKNOWN_CONTENT_TYPE);
    expect(sniffContentType(prefix(['PK', 0x03, 0x04]))).toBe('application/zip');
    expect(sniffContentType(prefix(['PK', 0x05, 0x06]))).toBe('application/zip');
  });

  it('does not let RIFF alone decide — an AVI is not a WAV', () => {
    // `RIFF` opens WAV, AVI and WebP alike. Matching on it without the form tag at offset 8 is
    // how a video gets stored as `audio/wav` and handed to an audio decoder.
    const avi = prefix(['RIFF', 0x24, 0x08, 0x00, 0x00, 'AVI LIST']);
    expect(sniffContentType(avi)).toBe(UNKNOWN_CONTENT_TYPE);
  });

  it('does not call arbitrary binary an MP3', () => {
    // 0xFF followed by a high nibble shows up constantly inside compressed data. The reserved
    // version and layer bits are what keep this from mistyping half the bucket.
    //
    // **One input per check.** The first pair of bytes tried here was 0xFF 0xE8, which trips
    // *both* reserved checks — so deleting either one left the test green and only the surviving
    // check was ever proven. Each byte below is rejected by exactly one of them (CLAUDE.md §13).
    //
    //   0xEA = 111 01 01 0 — reserved version (bits 4:3 = 01), layer bits valid.
    //   0xF8 = 111 11 00 0 — version valid (MPEG 1), reserved layer (bits 2:1 = 00).
    expect(sniffContentType(prefix([0xff, 0xea, 0x00, 0x00]))).toBe(UNKNOWN_CONTENT_TYPE);
    expect(sniffContentType(prefix([0xff, 0xf8, 0x00, 0x00]))).toBe(UNKNOWN_CONTENT_TYPE);

    // And a header that passes both is still an MP3, so the checks are not just refusing.
    expect(sniffContentType(prefix([0xff, 0xfb, 0x90, 0x00]))).toBe('audio/mpeg');
  });

  describe('the allowlist is the control', () => {
    // These are the cases the fallback exists for. A sniffer that "helpfully" recognized them
    // would record a renderable type against a key we hand back under a presigned URL.
    it.each([
      ['HTML', prefix(['<!DOCTYPE html><html>'])],
      ['an SVG', prefix(['<svg xmlns="http://www.w3.org/2000/svg">'])],
      ['a script', prefix(['#!/bin/sh\nrm -rf /'])],
      ['a PDF', prefix(['%PDF-1.7'])],
      ['nothing at all', new Uint8Array(0)],
      ['a truncated header', Uint8Array.from([0x52, 0x49])],
    ])('stores %s as an opaque download', (_label, bytes) => {
      expect(sniffContentType(bytes)).toBe(UNKNOWN_CONTENT_TYPE);
    });

    it('never returns a type outside the table', () => {
      // Property check over random input: whatever the bytes, the answer is one we chose.
      const allowed = new Set([
        'audio/wav',
        'audio/aiff',
        'audio/flac',
        'audio/x-caf',
        'audio/mpeg',
        'audio/mp4',
        'video/mp4',
        'audio/ogg',
        'application/zip',
        UNKNOWN_CONTENT_TYPE,
      ]);

      for (let i = 0; i < 2000; i += 1) {
        const bytes = Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
        expect(allowed).toContain(sniffContentType(bytes));
      }
    });
  });
});

describe('noticing that the client was wrong', () => {
  it('reports a disagreement', () => {
    expect(hintDisagrees('application/zip', 'audio/wav')).toBe(true);
  });

  it('accepts a hint with parameters on it', () => {
    // Browsers send `audio/wav; charset=utf-8` more often than anyone would like.
    expect(hintDisagrees('audio/wav; charset=utf-8', 'audio/wav')).toBe(false);
    expect(hintDisagrees('AUDIO/WAV', 'audio/wav')).toBe(false);
  });

  it('is not a disagreement when the client claimed nothing', () => {
    expect(hintDisagrees(null, UNKNOWN_CONTENT_TYPE)).toBe(false);
    expect(hintDisagrees('', UNKNOWN_CONTENT_TYPE)).toBe(false);
  });
});
