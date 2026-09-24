/**
 * Audio fixtures for probing.
 *
 * **Never real music** (CLAUDE.md §8, `docs/THREAT_MODEL.md` T9). Synthesized tones, a couple of
 * seconds long, produced here rather than committed as binaries — so nothing in this repository
 * is anyone's recording, and a fixture cannot drift from what the test claims it is.
 *
 * **The WAV bytes are written by this file, not by ffmpeg.** That is the point: a probe test
 * whose fixtures were produced by ffmpeg only proves ffprobe can read ffmpeg's output. Writing
 * the RIFF header here means the parser is tested against bytes it did not author, with sample
 * rate, bit depth, channel count and duration known exactly because we chose them. Compressed
 * fixtures are a different matter — hand-writing a valid AAC frame is not reasonable — so those
 * are transcoded *from* these, and their expected values inherited.
 *
 * `packages/db/src/seed/fixtures/audio.ts` does something similar for seed data. The duplication
 * is deliberate and forced: `media` may not import `db` and `db` may not import `media`
 * (`docs/ARCHITECTURE.md` §3). These fixtures answer "does the parser read this correctly"; those
 * answer "what does a seeded workspace contain".
 */

export interface ToneSpec {
  readonly sampleRateHz: number;
  readonly bitDepth: 16 | 24;
  readonly channels: 1 | 2;
  readonly seconds: number;
  readonly toneHz: number;
  /**
   * Peak amplitude as a fraction of full scale. Defaults to 0.5 (−6.02 dBFS). `0` is digital
   * silence — the case loudness measurement has to handle without an `-inf` leaking out.
   */
  readonly amplitude?: number;
}

/** The ffprobe codec name for a PCM WAV of this depth. 16- and 24-bit are not the same codec. */
export function pcmCodecFor(bitDepth: 16 | 24): string {
  return bitDepth === 16 ? 'pcm_s16le' : 'pcm_s24le';
}

/**
 * A mono or stereo sine tone as a complete WAV file.
 *
 * Canonical 44-byte header: `RIFF`, size, `WAVE`, `fmt ` chunk, `data` chunk. Nothing exotic —
 * no LIST, no fact chunk — because an exotic header would test our writer rather than the probe.
 */
export function generateWav(spec: ToneSpec): Uint8Array {
  const bytesPerSample = spec.bitDepth / 8;
  const frameCount = Math.floor(spec.sampleRateHz * spec.seconds);
  const blockAlign = bytesPerSample * spec.channels;
  const dataBytes = frameCount * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');

  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, spec.channels, true);
  view.setUint32(24, spec.sampleRateHz, true);
  view.setUint32(28, spec.sampleRateHz * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, spec.bitDepth, true);

  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  // Amplitude short of full scale, so a later loudness or peak test has headroom to measure
  // rather than a clipped square edge.
  const peak = 2 ** (spec.bitDepth - 1) - 1;
  const amplitude = Math.floor(peak * (spec.amplitude ?? 0.5));
  const step = (2 * Math.PI * spec.toneHz) / spec.sampleRateHz;

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const value = Math.round(Math.sin(frame * step) * amplitude);
    for (let channel = 0; channel < spec.channels; channel += 1) {
      if (spec.bitDepth === 16) {
        view.setInt16(offset, value, true);
        offset += 2;
      } else {
        // 24-bit little-endian: three bytes, sign carried in the top one.
        const unsigned = value < 0 ? value + 0x1000000 : value;
        bytes[offset] = unsigned & 0xff;
        bytes[offset + 1] = (unsigned >> 8) & 0xff;
        bytes[offset + 2] = (unsigned >> 16) & 0xff;
        offset += 3;
      }
    }
  }

  return bytes;
}

/** A file that is emphatically not audio, for the rejection paths. */
export function notAudioBytes(kind: 'text' | 'zip' | 'truncated-wav'): Uint8Array {
  if (kind === 'text') {
    return new TextEncoder().encode('these are lyrics, not a recording\n'.repeat(8));
  }
  if (kind === 'zip') {
    // A real (empty) zip: end-of-central-directory record and nothing else.
    return Uint8Array.from([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  }
  // A WAV header that promises audio and then stops. This is the interesting corrupt case: the
  // magic bytes are genuine, so `sniff.ts` calls it `audio/wav` and it reaches the probe.
  return generateWav({
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 2,
    seconds: 1,
    toneHz: 440,
  }).slice(0, 44);
}
