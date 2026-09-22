import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AAC_ENCODERS,
  assertCapabilities,
  capabilitiesFrom,
  MissingCapabilityError,
  parseNames,
  probeCapabilities,
  REQUIRED_ENCODERS,
  REQUIRED_FILTERS,
} from '../capabilities';
import { announceSkip, unavailableReason } from './prerequisite';

/**
 * The capability probe is the mitigation ADR 0002 and ADR 0004 both name, so the tests that
 * matter most are the ones where a build is *present but inadequate* — the case that otherwise
 * produces a silent, broken derivative nobody notices until playback.
 */
const reason = unavailableReason();
const describeWithFfmpeg = reason === null ? describe : describe.skip;
if (reason !== null) announceSkip('media capability tests', reason);

describeWithFfmpeg('reading what an ffmpeg build can do', () => {
  describe('parsing a listing', () => {
    // Real `ffmpeg -encoders` output. The header and rule have to be skipped, and the name is
    // the second field — not a substring of the line.
    const encoderListing = [
      'Encoders:',
      ' V..... = Video',
      ' A..... = Audio',
      ' ------',
      ' A....D aac                  AAC (Advanced Audio Coding)',
      ' A....D libopus              libopus Opus (codec opus)',
      ' A....D flac                 FLAC (Free Lossless Audio Codec)',
      '',
    ].join('\n');

    it('takes the name field, not the line', () => {
      expect(parseNames(encoderListing)).toEqual(['aac', 'libopus', 'flac']);
    });

    it('does not mistake libfdk_aac for aac', () => {
      // **The test this file exists for.** A build with `libfdk_aac` and no `aac` encoder is a
      // real and common configuration. A substring search finds `aac` inside `libfdk_aac`, calls
      // the capability satisfied, and the worker starts — then every `-c:a aac` fails at run
      // time, on someone's upload, hours later. The same trap catches `opus` inside `libopus`
      // in the other direction: a build with only the Opus *decoder* would pass.
      const misleading = [
        'Encoders:',
        ' ------',
        ' A....D libfdk_aac           Fraunhofer FDK AAC (codec aac)',
        ' A....D aac_at               AudioToolbox AAC (codec aac)',
        ' A....D opus                 Opus (experimental)',
        '',
      ].join('\n');

      const names = parseNames(misleading);
      expect(names).toEqual(['libfdk_aac', 'aac_at', 'opus']);
      expect(names).not.toContain('aac');
      expect(names).not.toContain('libopus');
    });

    it('skips the header, the legend and the rule', () => {
      expect(parseNames(encoderListing)).not.toContain('=');
      expect(parseNames(encoderListing)).not.toContain('------');
      expect(parseNames(encoderListing)).not.toContain('Encoders:');
    });

    it('reads a filter listing, which is formatted differently', () => {
      const filterListing = [
        'Filters:',
        '  T.. = Timeline support',
        '  ... ebur128           A->N       EBU R128 scanner.',
        '  ..C loudnorm          A->A       EBU R128 loudness normalization',
        '',
      ].join('\n');

      expect(parseNames(filterListing)).toEqual(['ebur128', 'loudnorm']);
    });

    it('returns nothing for empty or garbage input rather than throwing', () => {
      expect(parseNames('')).toEqual([]);
      expect(parseNames('not a listing at all')).toEqual([]);
    });
  });

  describe('deciding from a listing', () => {
    const goodFilters = ['Filters:', ' ------', ' ... ebur128  A->N  EBU R128 scanner.', ''].join(
      '\n',
    );

    it('accepts a build that has every required name exactly', () => {
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac      AAC (Advanced Audio Coding)',
        ' A....D libopus  libopus Opus (codec opus)',
        '',
      ].join('\n');

      expect(capabilitiesFrom(encoders, goodFilters).ok).toBe(true);
    });

    it('accepts libfdk_aac in place of the native encoder, as ADR 0004 allows', () => {
      // ADR 0004 requires "a usable AAC encoder (`aac` native, or `libfdk_aac`)". This gate used
      // to demand the exact name `aac`, and *this test asserted that refusal* — enshrining a
      // requirement stricter than the decision it cited. A build configured
      // `--enable-libfdk-aac --disable-encoder=aac` is an ordinary distribution choice, and
      // every worker on such an image would have exited at startup. Found in review.
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D libfdk_aac  Fraunhofer FDK AAC (codec aac)',
        ' A....D libopus     libopus Opus (codec opus)',
        '',
      ].join('\n');

      const capabilities = capabilitiesFrom(encoders, goodFilters);
      expect(capabilities.ok).toBe(true);
      // And it reports which one, so task `062` names what exists rather than assuming.
      expect(capabilities.aacEncoder).toBe('libfdk_aac');
    });

    it('prefers the native encoder when a build has both', () => {
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac         AAC (Advanced Audio Coding)',
        ' A....D libfdk_aac  Fraunhofer FDK AAC (codec aac)',
        ' A....D libopus     libopus Opus (codec opus)',
        '',
      ].join('\n');

      expect(capabilitiesFrom(encoders, goodFilters).aacEncoder).toBe('aac');
    });

    it('refuses a build with no AAC encoder at all', () => {
      // Still a refusal — and the exact-name parsing still matters, because `aac_at` and the
      // word "aac" inside a description must not satisfy it.
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac_at   AudioToolbox AAC (codec aac)',
        ' A....D libopus  libopus Opus (codec opus)',
        '',
      ].join('\n');

      const capabilities = capabilitiesFrom(encoders, goodFilters);
      expect(capabilities.ok).toBe(false);
      expect(capabilities.aacEncoder).toBeNull();
      expect(capabilities.missingEncoders.join(' ')).toMatch(/AAC encoder/);
    });

    it('refuses a build whose only opus support is the decoder', () => {
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac   AAC (Advanced Audio Coding)',
        ' A....D opus  Opus (decoder only in this build)',
        '',
      ].join('\n');

      const capabilities = capabilitiesFrom(encoders, goodFilters);
      expect(capabilities.ok).toBe(false);
      expect(capabilities.missingEncoders).toEqual(['libopus']);
    });

    it('refuses a build whose loudness filter is missing', () => {
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac      AAC (Advanced Audio Coding)',
        ' A....D libopus  libopus Opus (codec opus)',
        '',
      ].join('\n');
      const filters = ['Filters:', ' ------', ' ..C loudnorm  A->A  normalization', ''].join('\n');

      const capabilities = capabilitiesFrom(encoders, filters);
      expect(capabilities.ok).toBe(false);
      expect(capabilities.missingFilters).toEqual(['ebur128']);
      // `loudnorm` is present and is not a substitute: it normalizes, it does not measure.
      expect(capabilities.missingEncoders).toEqual([]);
    });

    it('refuses an empty listing rather than treating it as satisfied', () => {
      const capabilities = capabilitiesFrom('', '');
      expect(capabilities.ok).toBe(false);
      expect(capabilities.missingEncoders).toContain('libopus');
      expect(capabilities.missingEncoders.join(' ')).toMatch(/AAC encoder/);
      expect(capabilities.missingFilters).toEqual([...REQUIRED_FILTERS]);
    });
  });

  describe('against the real binary', () => {
    it('finds every capability the pipeline requires', async () => {
      const capabilities = await probeCapabilities();

      for (const encoder of REQUIRED_ENCODERS) {
        expect(capabilities.encoders).toContain(encoder);
      }
      for (const filter of REQUIRED_FILTERS) {
        expect(capabilities.filters).toContain(filter);
      }
      expect(capabilities.ok).toBe(true);
      // A parse that silently returned nothing would satisfy nothing above; this makes that
      // failure mode visible rather than implied.
      expect(capabilities.encoders.length).toBeGreaterThan(20);
      expect(capabilities.filters.length).toBeGreaterThan(20);
    }, 30_000);

    it('passes the assertion, so a working environment starts', async () => {
      await expect(assertCapabilities()).resolves.toMatchObject({ ok: true });
    }, 30_000);
  });

  describe('the startup gate itself', () => {
    /**
     * A stand-in ffmpeg that prints whatever listing the test wants.
     *
     * **Not a mock of the capability logic** — it is a real executable, run as a real child
     * process through the real `run()`, and the code under test cannot tell it from the genuine
     * binary. It exists because the interesting build is one this machine does not have, and
     * degrading the system ffmpeg is not something a test may do.
     */
    async function fakeFfmpeg(encoderListing: string, filterListing: string): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'fake-ffmpeg-'));
      const path = join(dir, 'ffmpeg');
      await writeFile(
        path,
        [
          '#!/bin/sh',
          'for arg in "$@"; do',
          `  if [ "$arg" = "-encoders" ]; then printf '%s' ${shellQuote(encoderListing)}; exit 0; fi`,
          `  if [ "$arg" = "-filters" ]; then printf '%s' ${shellQuote(filterListing)}; exit 0; fi`,
          'done',
          'exit 0',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      return path;
    }

    function shellQuote(text: string): string {
      return `'${text.replace(/'/g, `'"'"'`)}'`;
    }

    async function withFfmpeg<T>(path: string, run: () => Promise<T>): Promise<T> {
      const previous = process.env.YOUANDFRIENDS_FFMPEG_PATH;
      process.env.YOUANDFRIENDS_FFMPEG_PATH = path;
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env.YOUANDFRIENDS_FFMPEG_PATH;
        else process.env.YOUANDFRIENDS_FFMPEG_PATH = previous;
      }
    }

    const adequateFilters = ['Filters:', ' ------', ' ... ebur128  A->N  EBU R128 scanner.'].join(
      '\n',
    );

    it('throws when the build is missing an encoder — the whole point of the gate', async () => {
      // **The test this criterion is actually about.** Until it existed, deleting
      // `if (!capabilities.ok) throw ...` from `assertCapabilities` left all 86 tests green:
      // the only test that called it ran against the adequate ffmpeg on this machine, so the
      // branch never fired either way. `capabilitiesFrom` and `MissingCapabilityError` were both
      // well covered — but they are the helpers, and the gate is what ADR 0002 and ADR 0004 rely
      // on. Found in review, and the same shape as two earlier misses in this package.
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac_at   AudioToolbox AAC (codec aac)',
        ' A....D libopus  libopus Opus (codec opus)',
      ].join('\n');
      const fake = await fakeFfmpeg(encoders, adequateFilters);

      await withFfmpeg(fake, async () => {
        await expect(assertCapabilities()).rejects.toBeInstanceOf(MissingCapabilityError);
        await expect(assertCapabilities()).rejects.toThrow(/AAC encoder/);
        await expect(assertCapabilities()).rejects.toThrow(/will not start/);
      });
    }, 30_000);

    it('throws when the loudness filter is missing', async () => {
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac      AAC (Advanced Audio Coding)',
        ' A....D libopus  libopus Opus (codec opus)',
      ].join('\n');
      const fake = await fakeFfmpeg(encoders, 'Filters:\n ------\n ..C loudnorm A->A x');

      await withFfmpeg(fake, async () => {
        await expect(assertCapabilities()).rejects.toThrow(/filter ebur128/);
      });
    }, 30_000);

    it('returns the capabilities when the build is adequate, rather than throwing always', async () => {
      // Otherwise a gate that threw unconditionally would satisfy both tests above and stop
      // every worker in the fleet.
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac      AAC (Advanced Audio Coding)',
        ' A....D libopus  libopus Opus (codec opus)',
      ].join('\n');
      const fake = await fakeFfmpeg(encoders, adequateFilters);

      await withFfmpeg(fake, async () => {
        await expect(assertCapabilities()).resolves.toMatchObject({ ok: true });
      });
    }, 30_000);

    it('refuses to start when ffprobe is missing, even though ffmpeg is fine', async () => {
      // **Half the toolchain was never checked.** The gate only ever executed ffmpeg, so a worker
      // with a good ffmpeg and a mis-pointed `YOUANDFRIENDS_FFPROBE_PATH` started, consumed the
      // queue, and failed every job at run time with an environment fault — exactly the posture
      // this gate exists to prevent. Found in review.
      const encoders = [
        'Encoders:',
        ' ------',
        ' A....D aac      AAC (Advanced Audio Coding)',
        ' A....D libopus  libopus Opus (codec opus)',
      ].join('\n');
      const fake = await fakeFfmpeg(encoders, adequateFilters);

      const previousProbe = process.env.YOUANDFRIENDS_FFPROBE_PATH;
      process.env.YOUANDFRIENDS_FFPROBE_PATH = '/nonexistent/ffprobe';
      try {
        await withFfmpeg(fake, async () => {
          await expect(assertCapabilities()).rejects.toMatchObject({
            name: 'ToolError',
            reason: 'not_installed',
          });
        });
      } finally {
        if (previousProbe === undefined) delete process.env.YOUANDFRIENDS_FFPROBE_PATH;
        else process.env.YOUANDFRIENDS_FFPROBE_PATH = previousProbe;
      }
    }, 30_000);

    it('remaps a missing binary into a message about the worker, not about a listing', async () => {
      // Two different 3am problems: "install ffmpeg" and "your ffmpeg is the wrong build".
      // Deleting this remap also left every test green.
      await withFfmpeg('/nonexistent/ffmpeg', async () => {
        await expect(assertCapabilities()).rejects.toMatchObject({
          name: 'ToolError',
          reason: 'not_installed',
        });
        await expect(assertCapabilities()).rejects.toThrow(/will not start/);
      });
    }, 30_000);
  });

  describe('when the build is inadequate', () => {
    it('names what is missing, loudly', () => {
      // Constructed rather than probed: removing an encoder from a system ffmpeg is not
      // something a test may do, and the message is what an operator reads at 3am.
      const error = new MissingCapabilityError({
        encoders: ['flac'],
        filters: [],
        aacEncoder: null,
        missingEncoders: ['an AAC encoder (one of aac, libfdk_aac)', 'libopus'],
        missingFilters: ['ebur128'],
        ok: false,
      });

      expect(error.message).toContain('AAC encoder');
      expect(error.message).toContain('encoder libopus');
      expect(error.message).toContain('filter ebur128');
      expect(error.message).toContain('will not start');
      // Says *why* refusing is better than continuing, because the tempting fix when this fires
      // is to remove the check.
      expect(error.message).toContain('silently broken');
    });

    it('reports a missing binary differently from an inadequate one', async () => {
      // Two different operational problems: "install ffmpeg" and "your ffmpeg is the wrong
      // build". One message for both would send someone down the wrong path.
      const previous = process.env.YOUANDFRIENDS_FFMPEG_PATH;
      process.env.YOUANDFRIENDS_FFMPEG_PATH = '/nonexistent/ffmpeg';
      try {
        const { run } = await import('../run');
        await expect(run('/nonexistent/ffmpeg', ['-encoders'])).rejects.toMatchObject({
          name: 'ToolError',
          reason: 'not_installed',
        });
      } finally {
        if (previous === undefined) delete process.env.YOUANDFRIENDS_FFMPEG_PATH;
        else process.env.YOUANDFRIENDS_FFMPEG_PATH = previous;
      }
    }, 30_000);
  });

  it('requires libopus even though iteration one ships AAC', () => {
    // ADR 0004 defers Opus to task `205`. The encoder is still required at startup so that task
    // is a code change rather than a re-deploy of every worker. Pinned here because the obvious
    // "cleanup" is to drop it from the list.
    expect(REQUIRED_ENCODERS).toContain('libopus');
    expect(REQUIRED_FILTERS).toContain('ebur128');
    // AAC is required as a capability rather than as one name, per ADR 0004.
    expect(AAC_ENCODERS).toEqual(['aac', 'libfdk_aac']);
  });
});
