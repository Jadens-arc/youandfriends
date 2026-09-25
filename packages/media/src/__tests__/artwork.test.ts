import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ArtworkRejectedError,
  MAX_ARTWORK_PIXELS,
  probeArtwork,
  renderCoverRendition,
} from '../artwork';
import { generateWav } from '../fixtures/tone';
import { scratch, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('cover art rendition tests', reason);

/** A PNG chunk: length, type, data, CRC — enough to hand-build a header-only image. */
function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG that *declares* `width`×`height` in a few hundred bytes: the decompression-bomb shape. */
function declaredPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(1000))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Insert an EXIF segment carrying a GPS tag into a JPEG, right after its start-of-image marker —
 * what a phone photo looks like to the pipeline. Minimal but well-formed: `Exif\0\0`, a
 * little-endian TIFF header, and an IFD with one GPS-IFD pointer entry.
 */
function withExif(jpeg: Buffer): Buffer {
  const tiff = Buffer.from([
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00, // II*, IFD at 8
    0x01,
    0x00, // one entry
    0x25,
    0x88,
    0x04,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x1a,
    0x00,
    0x00,
    0x00, // GPSInfo → 26
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
    0x00,
    0x00, // GPS IFD with no entries
  ]);
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    tiff,
    Buffer.from('GPSMARKER'),
  ]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([0xff, 0xe1]),
    length,
    payload,
    jpeg.subarray(2),
  ]);
}

describeWithFfmpeg('cover art renditions (task 069)', () => {
  let files: Scratch;
  const images: Record<'jpeg' | 'png' | 'webp' | 'wide', string> = {} as never;

  beforeAll(async () => {
    files = await scratch();
    // Generated pictures, never someone's artwork: a test pattern at 800×600, in each format.
    images.jpeg = await files.synthesize('cover.jpg', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=800x600',
      '-frames:v',
      '1',
    ]);
    images.png = await files.synthesize('cover.png', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x640',
      '-frames:v',
      '1',
    ]);
    images.webp = await files.synthesize('cover.webp', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=512x512',
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
    ]);
    images.wide = await files.synthesize('wide.jpg', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1600x400',
      '-frames:v',
      '1',
    ]);
  }, 60_000);

  afterAll(async () => {
    await files?.cleanup();
  });

  it('reads the codec and declared size of each accepted format', async () => {
    expect(await probeArtwork(images.jpeg)).toEqual({ codec: 'mjpeg', width: 800, height: 600 });
    expect(await probeArtwork(images.png)).toEqual({ codec: 'png', width: 640, height: 640 });
    expect(await probeArtwork(images.webp)).toEqual({ codec: 'webp', width: 512, height: 512 });
  });

  it('renders square JPEGs at each width, cropping rather than squashing', async () => {
    for (const [source, width] of [
      [images.jpeg, 128],
      [images.png, 256],
      [images.webp, 512],
      [images.wide, 256],
    ] as const) {
      const output = join(files.dir, `out-${width}-${Math.random().toString(36).slice(2)}.jpg`);
      await renderCoverRendition(source, output, width);
      expect(await probeArtwork(output)).toEqual({ codec: 'mjpeg', width, height: width });
    }
  });

  it('strips EXIF, and with it the location a photo was taken', async () => {
    const tagged = await files.file('phone.jpg', withExif(await readFile(images.jpeg)));
    // The fixture really does carry it — otherwise this test would prove nothing.
    expect((await readFile(tagged)).includes(Buffer.from('Exif'))).toBe(true);
    expect((await readFile(tagged)).includes(Buffer.from('GPSMARKER'))).toBe(true);

    const output = join(files.dir, 'phone-256.jpg');
    await renderCoverRendition(tagged, output, 256);
    const rendition = await readFile(output);
    expect(rendition.includes(Buffer.from('Exif'))).toBe(false);
    expect(rendition.includes(Buffer.from('GPSMARKER'))).toBe(false);
    // No APP1 segment at all.
    expect(rendition.includes(Buffer.from([0xff, 0xe1]))).toBe(false);
  });

  it('refuses an image whose declared size is over the ceiling, before decoding it', async () => {
    const bomb = await files.file('bomb.png', declaredPng(8000, 8000));
    expect(8000 * 8000).toBeGreaterThan(MAX_ARTWORK_PIXELS);
    await expect(probeArtwork(bomb)).rejects.toMatchObject({ kind: 'image_too_large' });
  });

  it('refuses what is not a still image in an accepted format', async () => {
    const cases = [
      await files.file(
        'drawing.svg',
        new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      ),
      await files.file('notes.jpg', new TextEncoder().encode('not an image at all')),
      await files.file(
        'tone.wav',
        generateWav({ sampleRateHz: 44_100, bitDepth: 16, channels: 1, seconds: 1, toneHz: 440 }),
      ),
      await files.synthesize('clip.mp4', [
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:duration=1',
        '-pix_fmt',
        'yuv420p',
      ]),
      await files.file('huge-declared.png', declaredPng(100_000, 100_000)),
    ];
    for (const path of cases) {
      const error = await probeArtwork(path).catch((caught: unknown) => caught);
      expect(error, path).toBeInstanceOf(ArtworkRejectedError);
      expect((error as ArtworkRejectedError).kind).toBe('not_image');
    }
  });

  it('never overwrites, and never writes over its own input', async () => {
    const output = join(files.dir, 'once.jpg');
    await renderCoverRendition(images.jpeg, output, 128);
    await expect(renderCoverRendition(images.jpeg, output, 128)).rejects.toThrow(/overwrite/);
    await expect(renderCoverRendition(images.jpeg, images.jpeg, 128)).rejects.toThrow(/original/);
  });
});
