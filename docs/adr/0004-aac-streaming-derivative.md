# ADR 0004: AAC in fragmented MP4 as the streaming derivative

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

Originals are lossless and large — a 2 GB WAV is unusable for casual listening over a phone
connection. Every audio upload gets a fast streaming derivative. The original is preserved
untouched and offered for download to authorized users.

The primary listening surfaces are **Safari on iPhone** and desktop browsers. The design
requires background playback, Media Session integration, and AirPlay through native browser
media controls. Playback reliability on iOS is therefore the deciding constraint, not codec
efficiency.

## Decision

Produce **AAC-LC at 192 kbps stereo in a fragmented MP4 (`.m4a`) container**, 44.1 kHz.

Opus is deliberately **not** chosen for iteration one despite better efficiency at low
bitrates.

## Consequences

**Easier:** Universal playback. Safari, iOS, Android, and every desktop browser decode AAC in
MP4 natively. Native `<audio>` playback gives us Media Session, lock-screen controls, AirPlay,
and background audio with no custom work — the design explicitly requires these and explicitly
forbids claiming unsupported custom control. Byte-range seeking is well supported, which the
waveform scrubbing and A/B version switch depend on.

**Harder:** Larger files than Opus at equivalent perceptual quality — roughly 1.4 MB/minute at
192 kbps, so a four-minute song is about 5.6 MB. At 100 GB of originals the derivative
footprint is a small fraction of total storage, and R2's zero egress means transfer volume is
not billed. The cost is acceptable.

**Accepted:** We are optimizing for "it always plays" over "it is the smallest file." For a
product whose first principle is that listening never breaks, that is the correct trade.

## Assumptions to re-verify

- Safari on iOS still lacks dependable Opus-in-WebM support for `<audio>` across the iOS
  versions we target. **Re-verify before implementing task `102`** (mobile playback); if
  support has become dependable, adding an Opus derivative for capable clients is a small,
  additive change — the `derivatives` table already supports multiple rows per version.
- 192 kbps AAC-LC is perceptually sufficient for mix review. If collaborators report artifacts
  on dense material, the bitrate is a config value, not a code change.
- The Trigger.dev ffmpeg build includes a usable AAC encoder (`aac` native, or `libfdk_aac`).
  Task `060` probes encoder availability at startup and fails loudly.

## Alternatives considered

**Opus in WebM** — meaningfully better quality per bit and the right answer on a
Chromium-only product, but Safari/iOS support has been inconsistent, and iOS is a primary
surface. Deferred as an optional additional derivative for capable clients (task `205`).

**HLS with multiple bitrates** — the most robust streaming approach and ideal for variable
mobile connections, but it multiplies job complexity, storage, and playback code for a
private workspace where listeners are few and mostly on good connections. Planned as a
deferred enhancement (task `206`), not iteration one.

**MP3** — maximal compatibility including ancient clients, but worse quality per bit than AAC
with no compensating advantage on any browser we target.
