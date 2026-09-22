import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notAudioBytes } from '../fixtures/tone';
import { NotAudioError, probeAudio } from '../probe';
import { ToolError } from '../run';
import { probeResultSchema } from '../types';
import { MIXDOWN, SESSION, scratch, type Scratch } from './helpers';
import { announceSkip, unavailableReason } from './prerequisite';

/**
 * These run the real ffprobe against real files. There is no stub, deliberately: the thing under
 * test is a parser for another program's output, and a fake of that program would be a fake of
 * exactly the thing that varies (CLAUDE.md §7).
 */
/**
 * A shell would create the marker in whatever directory the process is standing in, and in both
 * the scratch directory, since ffprobe is given an absolute path. Both are checked, so the
 * assertion cannot pass by looking in the wrong place.
 */
async function expectNoMarker(marker: string): Promise<void> {
  const { access } = await import('node:fs/promises');
  const { join } = await import('node:path');

  for (const directory of [process.cwd(), tmpdir()]) {
    await expect(
      access(join(directory, marker)),
      `${marker} was created in ${directory} — something reached a shell`,
    ).rejects.toThrow();
  }
}

const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('media probe tests', reason);

describeWithFfmpeg('probing a file', () => {
  let files: Scratch;

  beforeAll(async () => {
    files = await scratch();
  }, 30_000);

  afterAll(async () => {
    await files?.cleanup();
  });

  it('reads a 16-bit WAV the way it was written', async () => {
    const path = await files.wav('mixdown.wav', MIXDOWN);
    const probe = await probeAudio(path);

    expect(probe).toMatchObject({
      codec: 'pcm_s16le',
      channels: 2,
      sampleRateHz: 44_100,
      bitDepth: 16,
      formatName: 'wav',
      durationMs: 2000,
      audioStreamCount: 1,
    });
  }, 30_000);

  it('distinguishes 24-bit from 16-bit', async () => {
    // Not a formality. `pcm_s16le` and `pcm_s24le` are different codecs, and a probe that
    // reported one depth for both would record the wrong technical detail on every session file
    // in the product. The two fixtures differ in sample rate and duration too, so a hardcoded
    // answer fails on more than one field.
    const path = await files.wav('session.wav', SESSION);
    const probe = await probeAudio(path);

    expect(probe).toMatchObject({
      codec: 'pcm_s24le',
      bitDepth: 24,
      sampleRateHz: 48_000,
      durationMs: 3000,
    });
  }, 30_000);

  it('reports no bit depth for a compressed codec, rather than zero', async () => {
    // ffprobe answers `bits_per_sample: 0` for AAC. Zero is not a bit depth; it is the absence
    // of one, and writing it into the database would say every streaming derivative is 0-bit.
    // This fixture is the only reason that distinction is testable at all.
    const source = await files.wav('for-aac.wav', MIXDOWN);
    const path = await files.encode('mixdown.m4a', source, ['-c:a', 'aac', '-b:a', '192k']);
    const probe = await probeAudio(path);

    expect(probe.codec).toBe('aac');
    expect(probe.bitDepth).toBeNull();
    expect(probe.sampleRateHz).toBe(44_100);
    expect(probe.channels).toBe(2);
    // Compressed duration comes from the container, not the stream.
    expect(probe.durationMs).toBeGreaterThan(1900);
    expect(probe.durationMs).toBeLessThan(2200);
  }, 60_000);

  it('reads a FLAC, where depth lives in a different field', async () => {
    // FLAC reports `bits_per_raw_sample` and leaves `bits_per_sample` at 0. A probe consulting
    // only the first field calls a lossless master unknown-depth.
    const source = await files.wav('for-flac.wav', SESSION);
    const path = await files.encode('session.flac', source, ['-c:a', 'flac']);
    const probe = await probeAudio(path);

    expect(probe.codec).toBe('flac');
    expect(probe.bitDepth).toBe(24);
  }, 60_000);

  it('counts more than one audio stream instead of hiding it', async () => {
    const first = await files.wav('a.wav', MIXDOWN);
    const path = await files.encode('two-streams.mka', first, [
      '-i',
      first,
      '-map',
      '0:a',
      '-map',
      '1:a',
      '-c:a',
      'flac',
    ]);
    const probe = await probeAudio(path);

    expect(probe.audioStreamCount).toBe(2);
  }, 60_000);

  describe('refusing what is not audio', () => {
    it('rejects a text file renamed to .wav', async () => {
      const path = await files.file('lyrics.wav', notAudioBytes('text'));
      await expect(probeAudio(path)).rejects.toBeInstanceOf(NotAudioError);
    }, 30_000);

    it('rejects a zip', async () => {
      const path = await files.file('project.wav', notAudioBytes('zip'));
      await expect(probeAudio(path)).rejects.toBeInstanceOf(NotAudioError);
    }, 30_000);

    it('rejects a WAV header with no audio behind it', async () => {
      // The interesting corrupt case: the magic bytes are genuine, so `sniffContentType` calls
      // this `audio/wav` and it gets all the way here before anything notices.
      const path = await files.file('truncated.wav', notAudioBytes('truncated-wav'));
      await expect(probeAudio(path)).rejects.toThrow(/duration/);
    }, 30_000);

    it('does not classify a rejection by what the path happens to say', async () => {
      // ffprobe's first stderr line contains the file's own path, and `validateAudio` used to
      // substring-match that message. A non-media file at `…/duration.wav` was therefore reported
      // as "contains a header but no audio" — a different failure, with a different message to
      // the person who uploaded it. The classification comes from a discriminant set where the
      // condition is known, so the filename cannot reach it.
      const path = await files.file('duration.wav', notAudioBytes('text'));

      const error = await probeAudio(path).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotAudioError);
      expect((error as NotAudioError).kind).toBe('not_media');

      const misleading = await files.file('no audio stream.wav', notAudioBytes('text'));
      const second = await probeAudio(misleading).catch((e: unknown) => e);
      expect((second as NotAudioError).kind).toBe('not_media');
    }, 30_000);

    it('rejects a file with no audio stream at all', async () => {
      // A still image probes perfectly well. It simply has nothing to play, which is a different
      // failure from "this file is broken" and needs a different message.
      const path = await files.synthesize('cover.png', [
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=32x32:d=1',
        '-frames:v',
        '1',
      ]);

      await expect(probeAudio(path)).rejects.toThrow(/no audio stream/);
    }, 60_000);

    it('reports a missing binary as an environment fault, not a bad file', async () => {
      // The distinction matters: one of these is the uploader's problem and one is ours. Telling
      // someone their master is corrupt because a worker lost its ffprobe is the worse mistake,
      // because the rejection gets written down.
      //
      // This asserts it through `probeAudio` rather than through `run()`. The earlier version
      // called `run()` directly and explained that the binary path was fixed at module load —
      // true at the time, and the same limitation was then used to justify not testing the
      // startup capability gate either. The paths are read per call now, so both are testable
      // and neither needs the excuse.
      const path = await files.wav('fine.wav', MIXDOWN);
      const previous = process.env.YOUANDFRIENDS_FFPROBE_PATH;

      process.env.YOUANDFRIENDS_FFPROBE_PATH = '/nonexistent/ffprobe';
      try {
        await expect(probeAudio(path)).rejects.toMatchObject({
          name: 'ToolError',
          reason: 'not_installed',
        });
        // Emphatically not a `NotAudioError`: the file is perfectly good.
        await expect(probeAudio(path)).rejects.not.toBeInstanceOf(NotAudioError);
      } finally {
        if (previous === undefined) delete process.env.YOUANDFRIENDS_FFPROBE_PATH;
        else process.env.YOUANDFRIENDS_FFPROBE_PATH = previous;
      }

      // The same file, once the environment is whole again. Without this the assertions above
      // would hold for a probe that simply always threw.
      await expect(probeAudio(path)).resolves.toMatchObject({ codec: 'pcm_s16le' });
    }, 30_000);
  });

  describe('a filename is only ever a filename', () => {
    // The marker filenames below deliberately contain no `/`: a slash makes the string a path
    // through directories that do not exist, and the first version of these tests failed on
    // `ENOENT` before reaching the probe at all — proving nothing about shells.
    it('does not interpret shell metacharacters in a path', async () => {
      // The whole reason `run.ts` uses `execFile` with an argument array. If any layer here
      // reached a shell, this filename would run `touch`. The file is named by the product from
      // an opaque key today, but a job payload is the wrong place to rely on that staying true.
      const path = await files.wav('take 1; touch pwned-semicolon .wav', MIXDOWN);

      const probe = await probeAudio(path);
      expect(probe.codec).toBe('pcm_s16le');

      // **Checked in the process working directory, not the scratch dir.** `touch pwned-semicolon`
      // creates its file wherever the shell is standing, which is the CWD — so the first version
      // of this assertion looked somewhere the marker could never appear and could not have
      // failed. It only caught a real shell because the mangled path also broke the probe, which
      // is luck rather than coverage. Running the `shell: true` mutation with the wrong assertion
      // left two real `pwned-*` files in `packages/media/`, which is how this was noticed.
      await expectNoMarker('pwned-semicolon');
    }, 30_000);

    it('does not expand a command substitution in a path', async () => {
      const path = await files.wav('take $(touch pwned-subst).wav', MIXDOWN);

      await expect(probeAudio(path)).resolves.toMatchObject({ channels: 2 });

      await expectNoMarker('pwned-subst');
    }, 30_000);

    it('does not treat a leading dash as an ffprobe option', async () => {
      // A filename beginning `-` is the other injection: not a shell problem, an *argument*
      // problem. Verified against the real binary: `ffprobe … -loglevel.wav` fails with
      // "Missing argument for option 'loglevel.wav'".
      //
      // **This test asserted nothing until it was rewritten.** It passed the absolute path that
      // `files.wav` returns, which begins `/`, so the dash was never at the front of an argument
      // and any guard could have been deleted. `probeAudio` now resolves its input, and the test
      // passes a genuinely relative path from a changed working directory — so the resolve is
      // what makes it pass. Found in review; the same shape as two other tests in this file.
      await files.wav('-loglevel.wav', MIXDOWN);

      const previous = process.cwd();
      process.chdir(files.dir);
      try {
        const probe = await probeAudio('-loglevel.wav');
        expect(probe.codec).toBe('pcm_s16le');
      } finally {
        process.chdir(previous);
      }
    }, 30_000);
  });

  it('gives up on a file rather than hanging on it', async () => {
    // A timeout is mandatory (task `060`): a malformed file must fail the job, not occupy a
    // worker forever. One millisecond is not a realistic limit; it is a reliable way to prove the
    // limit is wired to something.
    const path = await files.wav('slow.wav', SESSION);
    await expect(probeAudio(path, { timeoutMs: 1 })).rejects.toMatchObject({
      name: 'ToolError',
      reason: 'timed_out',
    });
  }, 30_000);

  it('refuses output larger than the buffer allows, rather than holding it all', async () => {
    // A hostile file can make ffprobe emit megabytes of stream metadata. Buffering that
    // unbounded is how one upload exhausts a worker's memory; the cap is what stops it, and
    // nothing exercised the branch that reports hitting it.
    const path = await files.wav('verbose.wav', MIXDOWN);
    await expect(probeAudio(path, { maxOutputBytes: 8 })).rejects.toMatchObject({
      name: 'ToolError',
      reason: 'output_too_large',
    });
  }, 30_000);

  it('refuses output it cannot interpret, rather than reading fields off it', async () => {
    // Valid JSON of the wrong shape. ffprobe's output differs across builds, and this is the
    // branch that catches a shape this parser was not written for — reached through a real child
    // process printing real bytes, not by calling the schema directly.
    const fake = join(files.dir, 'weird-ffprobe');
    await writeFile(
      fake,
      ['#!/bin/sh', `printf '%s' '{"streams": "not an array", "format": 7}'`, ''].join('\n'),
      { mode: 0o755 },
    );

    const previous = process.env.YOUANDFRIENDS_FFPROBE_PATH;
    process.env.YOUANDFRIENDS_FFPROBE_PATH = fake;
    try {
      await expect(probeAudio(join(files.dir, 'anything.wav'))).rejects.toThrow(
        /could not interpret/,
      );
    } finally {
      if (previous === undefined) delete process.env.YOUANDFRIENDS_FFPROBE_PATH;
      else process.env.YOUANDFRIENDS_FFPROBE_PATH = previous;
    }
  }, 30_000);

  it('produces a probe the shared job contract accepts', async () => {
    // `probeResultSchema` is what crosses the process boundary into `apps/jobs`. It was defined,
    // exported and never checked against an actual probe, so it could drift from `AudioProbe`
    // and nothing would notice until a worker rejected a real payload.
    const path = await files.wav('contract.wav', SESSION);
    const probe = await probeAudio(path);

    expect(() => probeResultSchema.parse(probe)).not.toThrow();
  }, 30_000);

  it('classifies a ToolError rather than letting a raw exec error escape', async () => {
    const error = new ToolError('ffprobe', 'failed', 'boom', 'stderr text');
    expect(error.name).toBe('ToolError');
    expect(error.stderr).toBe('stderr text');
  });
});
