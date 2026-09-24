# 068 — Threat model the media pipeline

**Phase:** Media pipeline · **Iteration:** one

## Objective

Add a threat-model section covering what happens when this product decodes a file a stranger
uploaded, and name the controls that answer it.

## User value

None directly. It gives every later media task something to be reviewed against, instead of each
reviewer re-deriving the surface from scratch.

## Why this exists

`docs/THREAT_MODEL.md` covers T1–T10. T4 covers the upload _transaction_ — session ownership,
finalize verification, magic-byte typing, "no ZIP is expanded server-side" — and stops there.

Task `060` introduced ffmpeg and ffprobe: two large C programs, run against arbitrary uploaded
bytes, in a worker with credentials. Nothing in the threat model covers that surface. The
security review of `060` found five defects in it and noted that the model had no section to
review them against; three of the five were mitigations that existed only as ffmpeg's defaults
rather than as anything this repository asserts.

Specifically unmodelled today:

- **Decoder and demuxer exploitation.** A malformed container is the classic memory-safety
  target, and it arrives from anyone with upload access.
- **External-reference demuxers.** HLS playlists, concat lists and QuickTime data references can
  name other files or URLs. ffmpeg 6.1.1 happens to refuse non-`file` protocols when the outer
  input is `file:`, and `060` now passes `-protocol_whitelist file` explicitly — but nothing pins
  a minimum ffmpeg version, so the underlying property is inherited rather than guaranteed.
- **Worker resource exhaustion.** `maxBuffer` bounds the parent process. The child's memory is
  unbounded, and nothing sets `-probesize` or `-analyzeduration`. The intended control is a
  container memory limit, which is a deployment property written down nowhere.
- **Orphaned children.** Fixed in `060` (`killSignal: 'SIGKILL'`), but the general rule — a job
  must not be able to outlive its timeout — belongs in the model rather than in one file's
  comment.
- **Scratch-space disclosure.** `mkdtemp` gives 0700, so a co-tenant cannot read the decoded copy
  of someone's master. That is the property that matters most here and it is currently
  accidental.

## Scope

- A **T11 — Media processing of untrusted files** section in `docs/THREAT_MODEL.md`: assets, the
  trust boundary, the threats above, and the control answering each.
- Controls named explicitly, so a review can check them: argument vector never a shell string,
  absolute paths only, `-protocol_whitelist file`, hard kill on timeout, bounded parent output,
  container memory and disk limits, 0700 scratch space, no ZIP expansion.
- A minimum ffmpeg version, recorded in `README.md` prerequisites and asserted by
  `assertCapabilities()` — the version is what makes several of the above true.
- A line in `docs/OPERATIONS.md` for the deployment-owned limits (memory, disk, job concurrency).

## Non-scope

- Sandboxing the decoder (seccomp, a separate container per job). Worth considering; it is a
  deployment change with its own trade-offs and does not belong in a documentation task.
- Re-auditing `060`, which the review already covered.

## Dependencies

`060`

## Files expected to change

```
docs/THREAT_MODEL.md
docs/OPERATIONS.md
README.md
packages/media/src/capabilities.ts   (minimum version assertion)
packages/media/src/__tests__/**
```

## Implementation notes

- The existing sections are the format to follow: asset, boundary, threat, control, and where the
  control is tested.
- A minimum version is only a control if it is checked. `ffmpeg -version` output parses to a
  semantic-ish version; the gate already runs both binaries, so the cost is a parse.

## Security/privacy considerations

This task _is_ the security consideration. The thing being protected is unreleased music, and the
new surface is a decoder running against whatever someone uploads.

## Acceptance criteria

- [x] `docs/THREAT_MODEL.md` has a T11 section covering decoder exploitation, external-reference demuxers, resource exhaustion, orphaned children, and scratch-space disclosure. (Numbered **T12**: T11 was taken by invitation abuse, task `032`. It also covers command injection, a payload naming another object, and tool output reaching a person. The unsandboxed decoder is recorded as a residual risk.)
- [x] Each threat names its control and where that control is enforced. (A table: threat, control, the file that enforces it, the test that proves it.)
- [x] A minimum ffmpeg version is recorded and asserted at startup, with a test. (`MINIMUM_FFMPEG_VERSION` = 6.1 in `packages/media/src/capabilities.ts`; `assertCapabilities` reads both binaries' `-version` and refuses an older build or an unversioned git snapshot; README prerequisites say 6.1. Tested with a stand-in ffmpeg reporting 4.4.2, 6.0 and a git snapshot, and with an old ffprobe alone; mutation-checked.)
- [x] `docs/OPERATIONS.md` names the deployment-owned limits. (§3: memory per worker, disk, concurrency, maximum duration, ffmpeg version.)

**A gap found while writing the model, and closed.** Only `probeAudio` passed `-protocol_whitelist file`; the loudness, derivative and waveform invocations did not, so the model would have named a control that three of four call sites lacked. All four now build their input with `untrustedInput()` in `packages/media/src/run.ts`, which also refuses a relative path. Tested, along with the 0700 mode of scratch directories, which was previously a property of `mkdtemp` that nothing asserted.

**Manual QA** 1 is the automated test above: `YOUANDFRIENDS_FFMPEG_PATH` pointed at a stub reporting an old version is refused.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
pnpm release-check
```

## Manual QA

1. Point `YOUANDFRIENDS_FFMPEG_PATH` at a stub reporting an old version; confirm startup refuses.

## Rollback/compatibility

Documentation plus one startup assertion. Reverting loses the model and the version floor.

## Status

`complete`

## Commit

_(not yet)_
