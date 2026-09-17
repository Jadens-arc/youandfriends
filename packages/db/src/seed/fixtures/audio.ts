import { createHash } from 'node:crypto';

/**
 * Generated audio fixtures.
 *
 * **Never real music** (`docs/THREAT_MODEL.md` T9, CLAUDE.md §8). These are synthesized tones:
 * legally unambiguous, a few seconds long, and produced by this file rather than committed as
 * binaries. Task `066` reuses them as media-pipeline fixtures, which is why the durations and
 * sample formats are deliberate rather than arbitrary.
 *
 * WAV is written here in full, because a RIFF header and PCM samples are a few dozen lines and
 * a dependency for that would be silly. FLAC, MP3, and M4A need an encoder; see
 * {@link ENCODED_FORMATS}.
 */

export interface WavFormat {
  readonly name: string;
  readonly sampleRateHz: number;
  readonly bitDepth: 16 | 24;
  readonly channels: 1 | 2;
  readonly seconds: number;
  /** Hz. Different per fixture so a waveform test can tell two files apart. */
  readonly toneHz: number;
}

/**
 * The formats task `066` needs from this generator.
 *
 * 44.1/16 is what a mixdown usually is; 48/24 is what a session usually is. Both are stereo,
 * because a mono fixture would not exercise channel handling.
 */
export const WAV_FORMATS: readonly WavFormat[] = [
  {
    name: 'tone-44100-16.wav',
    sampleRateHz: 44_100,
    bitDepth: 16,
    channels: 2,
    seconds: 2,
    toneHz: 440,
  },
  {
    name: 'tone-48000-24.wav',
    sampleRateHz: 48_000,
    bitDepth: 24,
    channels: 2,
    seconds: 3,
    toneHz: 220,
  },
];

/**
 * Formats that need an encoder we do not have yet.
 *
 * ffmpeg arrives with task `064` (ADR 0002's build extension). Until then this generator
 * **says so** rather than shipping a stub: a fixture that claims to be a FLAC and is not would
 * make task `066`'s media tests pass against something that was never encoded.
 */
export const ENCODED_FORMATS = ['flac', 'mp3', 'm4a'] as const;

/** Whether an encoder is available to produce {@link ENCODED_FORMATS}. */
export function encoderAvailable(): boolean {
  // Replaced by a real probe in task `064`, where ffmpeg becomes a dependency rather than a
  // hope. Returning `false` honestly is the point today.
  return false;
}

const RIFF_HEADER_BYTES = 44;

/**
 * A complete WAV file: RIFF header plus PCM samples of a sine tone.
 *
 * The tone fades in and out over 50 ms at each end. Without it the file starts and stops on a
 * discontinuity, which shows up as a click — and as a spurious true-peak reading in the
 * loudness analysis task `062` runs over exactly these fixtures.
 */
export function generateWav(format: WavFormat): Buffer {
  const { sampleRateHz, bitDepth, channels, seconds, toneHz } = format;
  const bytesPerSample = bitDepth / 8;
  const frameCount = Math.floor(sampleRateHz * seconds);
  const dataBytes = frameCount * channels * bytesPerSample;

  const buffer = Buffer.alloc(RIFF_HEADER_BYTES + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM subchunk size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * channels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  const fadeFrames = Math.floor(sampleRateHz * 0.05);
  const peak = 2 ** (bitDepth - 1) - 1;
  // -6 dBFS, so the fixture is not at full scale and a limiter test has somewhere to go.
  const amplitude = peak * 0.5;

  let offset = RIFF_HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const envelope = Math.min(1, frame / fadeFrames, (frameCount - frame) / fadeFrames);
    const value = Math.round(
      Math.sin((2 * Math.PI * toneHz * frame) / sampleRateHz) * amplitude * envelope,
    );

    for (let channel = 0; channel < channels; channel += 1) {
      if (bitDepth === 16) {
        buffer.writeInt16LE(value, offset);
      } else {
        // 24-bit little-endian, which Node has no helper for.
        buffer.writeUInt8(value & 0xff, offset);
        buffer.writeUInt8((value >> 8) & 0xff, offset + 1);
        buffer.writeUInt8((value >> 16) & 0xff, offset + 2);
      }
      offset += bytesPerSample;
    }
  }

  return buffer;
}

export interface GeneratedFixture {
  readonly name: string;
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly durationMs: number;
  readonly sampleRateHz: number;
  readonly bitDepth: number;
  readonly channels: number;
  /** The ffprobe codec name for this PCM format. 16- and 24-bit are not the same codec. */
  readonly codec: string;
}

export function generateFixture(format: WavFormat): GeneratedFixture {
  const bytes = generateWav(format);
  return {
    name: format.name,
    bytes,
    sizeBytes: bytes.byteLength,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: 'audio/wav',
    durationMs: format.seconds * 1000,
    sampleRateHz: format.sampleRateHz,
    bitDepth: format.bitDepth,
    channels: format.channels,
    codec: format.bitDepth === 16 ? 'pcm_s16le' : 'pcm_s24le',
  };
}

/** Every WAV fixture, generated. Deterministic: the same bytes and checksum every run. */
export function generateAllFixtures(): GeneratedFixture[] {
  return WAV_FORMATS.map(generateFixture);
}

/**
 * The ceiling a committed fixture may not exceed.
 *
 * Nothing is committed today — the generator produces bytes at run time — but task `066` may
 * want a golden file, and this is the documented limit it has to fit under. Two seconds of
 * 44.1/16 stereo is about 350 KB.
 */
export const MAX_COMMITTED_FIXTURE_BYTES = 1_048_576;
