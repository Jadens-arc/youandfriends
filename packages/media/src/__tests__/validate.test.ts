import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notAudioBytes } from '../fixtures/tone';
import { validateAudio, MAX_DURATION_MS } from '../validate';
import { MIXDOWN, SESSION, scratch, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('media validation tests', reason);

describeWithFfmpeg('validating an upload', () => {
  let files: Scratch;

  beforeAll(async () => {
    files = await scratch();
  }, 30_000);

  afterAll(async () => {
    await files?.cleanup();
  });

  it('accepts an ordinary mixdown', async () => {
    const path = await files.wav('mixdown.wav', MIXDOWN);
    const result = await validateAudio(path);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.probe.codec).toBe('pcm_s16le');
    expect(result.notes).toEqual([]);
  }, 30_000);

  describe('rejecting', () => {
    it('gives a reason a person can read, not a code', async () => {
      const path = await files.file('lyrics.wav', notAudioBytes('text'));
      const result = await validateAudio(path);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure).toBe('not_media');
      expect(result.reason).toMatch(/could not read this file as media/);
    }, 30_000);

    it('separates "no audio in it" from "not media at all"', async () => {
      // Both are rejections, and they are not the same thing. Someone who uploaded a photo needs
      // a different sentence from someone whose file is damaged.
      const image = await files.synthesize('cover.png', [
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=32x32:d=1',
        '-frames:v',
        '1',
      ]);
      const result = await validateAudio(image);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure).toBe('no_audio_stream');
    }, 60_000);

    it('rejects a header with no audio behind it', async () => {
      const path = await files.file('truncated.wav', notAudioBytes('truncated-wav'));
      const result = await validateAudio(path);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure).toBe('no_duration');
    }, 30_000);

    it('reports not_media for a non-media file whose name mentions duration', async () => {
      // The consumer half of the same bug: `validateAudio` classified by substring-matching a
      // message that embeds the path. `…/duration.wav` came back as `no_duration`, which tells
      // someone their file has a header and no audio when in fact it is not media at all.
      const path = await files.file('duration.wav', notAudioBytes('text'));
      const result = await validateAudio(path);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure).toBe('not_media');
    }, 30_000);

    it('refuses something implausibly long, and says by how much', async () => {
      // A resource limit, not taste. The fixture is two seconds and the limit is one, because
      // generating a six-hour file to test a six-hour limit is not a trade worth making.
      const path = await files.wav('long.wav', MIXDOWN);
      const result = await validateAudio(path, { maxDurationMs: 1000 });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure).toBe('too_long');
      expect(result.reason).toMatch(/limit/);
    }, 30_000);
  });

  describe('accepting what is merely unusual', () => {
    // Originals are sacred. These are the cases where a stricter validator would refuse real
    // work people do, and each one is a note rather than a rejection.
    it('accepts a mono voice memo', async () => {
      const path = await files.wav('memo.wav', { ...MIXDOWN, channels: 1 });
      const result = await validateAudio(path);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.probe.channels).toBe(1);
    }, 30_000);

    it('accepts a multi-channel stem bounce, with a note', async () => {
      const source = await files.wav('stereo.wav', MIXDOWN);
      const path = await files.encode('six.wav', source, ['-ac', '6']);
      const result = await validateAudio(path);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.probe.channels).toBe(6);
      expect(result.notes.join(' ')).toMatch(/6 channels/);
    }, 60_000);

    it('accepts a file with two audio streams, and says which one it used', async () => {
      // Guessing which stream is "the song" is how the wrong take becomes the master. It is
      // recorded and surfaced instead.
      const first = await files.wav('one.wav', MIXDOWN);
      const path = await files.encode('two.mka', first, [
        '-i',
        first,
        '-map',
        '0:a',
        '-map',
        '1:a',
        '-c:a',
        'flac',
      ]);
      const result = await validateAudio(path);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.notes.join(' ')).toMatch(/2 audio streams.*first was used/);
    }, 60_000);

    it('accepts a session file at 48/24', async () => {
      const path = await files.wav('session.wav', SESSION);
      await expect(validateAudio(path)).resolves.toMatchObject({ ok: true });
    }, 30_000);
  });

  it('throws rather than rejecting when the environment is broken', async () => {
    // An environment fault is never the uploader's fault. If this became a rejection, a worker
    // that lost its ffprobe would tell everyone their masters were corrupt — and the file would
    // be marked bad in the database, which is the part that does not undo itself.
    //
    // A 1ms timeout is the reliable way to provoke a `ToolError` against a file that is
    // perfectly fine. The first version of this test called `run()` directly, which proved the
    // classification but never touched `validateAudio` — so turning the rethrow into a
    // `{ ok: false }` rejection passed all 86 tests.
    const path = await files.wav('perfectly-fine.wav', SESSION);

    await expect(validateAudio(path, { timeoutMs: 1 })).rejects.toMatchObject({
      name: 'ToolError',
      reason: 'timed_out',
    });

    // And the same file validates when the environment is not broken, so the assertion above is
    // about the environment rather than the file.
    await expect(validateAudio(path)).resolves.toMatchObject({ ok: true });
  }, 30_000);

  it('has a default limit that is generous rather than tasteful', () => {
    // Six hours. Long enough for an album-length ambient piece or a DJ set, which are real
    // things people keep in a music workspace.
    expect(MAX_DURATION_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
  });
});
