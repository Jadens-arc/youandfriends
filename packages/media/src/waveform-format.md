# Waveform peaks format, version 1

_Task `063`. The generator is `packages/media/src/waveform.ts`; the encoder and decoder are
`packages/contracts/src/waveform.ts`, shared by the worker and the browser player (task `072`)
so the two cannot drift. If this document and that file disagree, the code is wrong._

Stored as a `waveform_peaks` derivative (`derivatives.kind`), served only through an authorized,
short-lived presigned URL — a waveform reveals the length and structure of unreleased music.

## Layout

All integers are little-endian.

| Offset | Size | Field                                                    |
| ------ | ---- | -------------------------------------------------------- |
| 0      | 4    | Magic, ASCII `YFWP`                                      |
| 4      | 1    | Version, `1`                                             |
| 5      | 1    | Source channel count (informational)                     |
| 6      | 2    | Tier count, `u16`                                        |
| 8      | 4    | Source sample rate in Hz, `u32`                          |
| 12     | 4    | Source frame count, high 32 bits, `u32`                  |
| 16     | 4    | Source frame count, low 32 bits, `u32`                   |
| 20     | 8·n  | Tier table: per tier, frames per bucket and bucket count |
| …      | 2·Σ  | Tier data in table order: per bucket, `i8` min, `i8` max |

A decoder must reject a wrong magic, an unknown version, a table or data section that runs past
the end of the buffer, and trailing bytes.

## Semantics

- Tiers are ordered **coarsest first**, each strictly coarser than the next: an overview of about
  1,000 buckets for the whole track, a medium tier at 50 buckets per second, and a fine tier at
  200 buckets per second. A track under about 20 seconds has no overview — 1,000 buckets would be
  finer than the medium tier — so it carries two tiers. Readers must use the tier table, never
  assume three.
- A bucket's min and max are the extreme samples across **every channel** in its frames, so a
  mono, stereo, or multichannel source all produce one envelope.
- Samples in [-1, 1] are scaled to [-127, 127]: minimums round down, maximums round up, so a
  quiet passage is never drawn flatter than it is.
- Peaks come from the **original**, decoded at its own sample rate — never from the lossy
  streaming derivative.
- The same original always produces byte-identical output.

## Size

Two bytes per bucket. A four-minute song is about 60 KB across all three tiers. The same integers
as JSON are more than twice that, and the usual JSON of float peaks more than ten times.
