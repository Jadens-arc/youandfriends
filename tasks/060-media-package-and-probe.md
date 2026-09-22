# 060 — Media package, ffprobe validation, capability probe

**Phase:** Media pipeline · **Iteration:** one

## Objective

Create `packages/media`: ffprobe-based validation and metadata extraction, plus a startup capability probe that fails loudly if the required encoders and filters are absent.

## User value

Accurate duration, format, and technical detail on every upload — and a pipeline that reports a broken environment instead of producing silently broken output.

## Scope

- ffprobe invocation and typed parsing of duration, codec, channels, sample rate, and bit depth.
- Media validation rejecting non-media and corrupt files with a clear reason.
- A capability probe asserting the presence of the `aac` encoder, `libopus`, and the `ebur128` filter (ADR 0002, ADR 0004).
- Typed job input/output contracts shared with `apps/jobs`.
- A `JobDispatcher` interface with `TriggerDispatcher` and `InlineDispatcher` implementations (ADR 0002).

## Non-scope

- Transcoding (task `062`), loudness (task `061`), waveforms (task `063`).
- Trigger.dev wiring (task `064`).
- Video. Audio only.

## Dependencies

`050`, `003`

## Files expected to change

```
packages/media/src/{probe,validate,capabilities,dispatcher,types}.ts
packages/media/src/__tests__/**
packages/media/src/fixtures/**
```

## Implementation notes

- The capability probe is the specific mitigation for ADR 0002's and 0004's stated risk: an ffmpeg build without the encoders we need. It must **fail loudly at startup**, not produce a silently broken derivative that nobody notices until playback.
- Parse ffprobe JSON output into typed values and validate with Zod. ffprobe output varies across builds and inputs; unchecked field access is how this breaks on one unusual file.
- Reject non-media early. An uploaded ZIP misclassified as audio should fail validation with a clear reason, not crash the transcoder.
- `InlineDispatcher` runs the real pipeline synchronously against fixtures in tests — the pipeline itself is never mocked, only its scheduling.
- Never shell out with unsanitized input. Pass arguments as an array, never through a shell string.

## Security/privacy considerations

ffmpeg and ffprobe process untrusted user files. Arguments are passed as arrays, never interpolated into a shell. Processing happens in isolated temporary storage with bounded disk and time limits. A malformed file must fail the job cleanly, not hang it — job timeouts are mandatory, not optional.

## What review found

Both reviewers were given the diff and the ten mutations already run, and asked for what those
missed. Between them they found eight defects. Each is fixed here and pinned by a test that fails
when the fix is reverted — twenty mutations in total.

**The startup gate was never made to fail.** `assertCapabilities` is the function ADR 0002 and
ADR 0004 rely on, and deleting its refusal outright left all 86 tests green: `capabilitiesFrom`
and `MissingCapabilityError` were both covered, but they are the helpers. The cause was mine —
the binary paths were module-load constants, so no test could point the gate at an inadequate
build, and _two test comments cited that limitation as a reason to test something else instead_.
The paths are read per call now, which also makes `YOUANDFRIENDS_FFMPEG_PATH` work as documented.

**The timeout did not reap.** `execFile`'s timeout signals and then waits for the child to close,
so with the default SIGTERM a child that defers it leaves the promise pending forever and the
process orphaned — and ffmpeg defers it exactly that way. Measured on a stub trapping SIGTERM:
still pending after six seconds against a 1.5 second limit, versus 1505 ms with `SIGKILL`. One
wedged job would have held a worker slot permanently, and an orphan holding unlinked files open
defeats the scratch-space cleanup too.

**Two tests asserted controls that were not there.** The leading-dash test passed the absolute
path its helper returns, so the dash was never at the front of an argument; a relative
`-loglevel.wav` really is consumed as an option. And the shell-injection tests looked for their
marker file in the scratch directory, while `touch` creates it in the working directory — they
caught the `shell: true` mutation only because the mangled path also broke the probe. Noticed
when that mutation left two real `pwned-*` files in `packages/media`.

**Rejections were classified by prose.** `validateAudio` substring-matched ffprobe's message,
which embeds the file's own path — so a non-media file at `…/duration.wav` was reported as "a
header with no audio". `NotAudioError` carries a discriminant now, and the stderr excerpt is
bounded and stripped of control characters before it reaches a screen.

**Half the toolchain was unchecked.** The gate only executed ffmpeg, so a worker with a
mis-pointed `YOUANDFRIENDS_FFPROBE_PATH` started, consumed the queue and failed every job.

**The gate was stricter than the decision it cited.** ADR 0004 requires "a usable AAC encoder
(`aac` native, or `libfdk_aac`)"; the gate demanded the exact name `aac`, and the headline test
enshrined that refusal. Every worker on a `--enable-libfdk-aac --disable-encoder=aac` image would
have exited at startup for a build the ADR blesses. The requirement is now the capability, and
`Capabilities.aacEncoder` reports which encoder was found so task `062` names what exists.

**The scratch prefix was trusted**, though it is composed into a path later removed recursively —
and the docstring claimed no part of the name came from a caller. The first fix still admitted
`..`, which `join(tmpdir(), '..')` resolves to `/`; the test for the guard caught it.

**An idempotency key was not bound to its work.** Trigger.dev keys are project-global, so a
caller deriving one from a filename would have had one workspace's upload return another's
handle — the job never runs, the caller is told `queued`, and the asset sits in "processing".

`-protocol_whitelist file` was added to the probe as defence in depth: ffmpeg's defaults happen
to refuse external references from a `file:` input, and inheriting a property is not asserting
it. One finding went to a new task rather than being folded in: `docs/THREAT_MODEL.md` has no
section covering media processing of untrusted files at all, which is task `068`.

## Acceptance criteria

- [x] **ffprobe extracts duration, codec, channels, sample rate, and bit depth, parsed with Zod.**
  - `reads a 16-bit WAV the way it was written`, `distinguishes 24-bit from 16-bit`
  - `reports no bit depth for a compressed codec, rather than zero` (real AAC)
  - `reads a FLAC, where depth lives in a different field` (`bits_per_raw_sample`)
  - `produces a probe the shared job contract accepts`
  - Mutation P1 (one field only, zero kept as a depth) fails two by name.

- [x] **Non-media and corrupt files are rejected with a clear reason.**
  - text, zip, truncated WAV, and a still image — four different failures, four `kind`s
  - `does not classify a rejection by what the path happens to say`
  - `refuses output it cannot interpret, rather than reading fields off it`
  - Mutations P10 and F3 each fail a test by name.

- [x] **The capability probe fails loudly when a required encoder or filter is missing.**
  - `throws when the build is missing an encoder — the whole point of the gate`
  - `throws when the loudness filter is missing`
  - `refuses to start when ffprobe is missing, even though ffmpeg is fine`
  - `remaps a missing binary into a message about the worker, not about a listing`
  - Tested against a real child process reporting a build this machine does not have.
  - Mutations C1, C2, P2 and F4 each fail a test by name.

- [x] **`JobDispatcher` has Trigger and Inline implementations; the pipeline is never mocked.**
  - The seam is the queue; `InlineDispatcher` runs the runner it is given.
  - `does not collapse two workspaces that chose the same key`, `refuses the same key for
different work inside one workspace`, `reports a queue failure instead of inventing a handle`
  - Mutations P5, P6 and F7 each fail a test by name.
  - **Note:** there is no pipeline to inject yet — transcode, loudness and waveforms are tasks
    `061`–`063`. The claim is about the design, not yet demonstrated end to end; the first
    `InlineDispatcher` test threading real work through the runner belongs to `062`.

- [x] **No shell interpolation of user-controlled values.**
  - `execFile` with an argument vector and `shell: false` stated explicitly
  - filenames containing `; touch` and `$(touch)`, asserted against the working directory _and_
    tmp, after the original assertion was found to check neither
  - a genuinely relative `-loglevel.wav` from a changed working directory
  - Mutations P3 and F2 each fail a test by name.

- [x] **Jobs have enforced timeouts and bounded temporary disk use.**
  - `kills a child that ignores SIGTERM, rather than waiting forever`
  - `refuses output larger than the buffer allows`
  - `cleans up when the job throws — the path that actually leaves debris`
  - `refuses a prefix that could escape the temp directory`, symlink exclusion, budget checks
  - Mutations P4, P7, P8, R1 and F5 each fail a test by name.
  - **Honest limit:** `assertWithinBudget` is a check, not a quota — it cannot stop a single
    write from filling a disk between two calls, and the file says so. Nothing in this package
    calls it yet; task `062` is the first caller that will.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
ffmpeg -version   # local prerequisite
```

## Manual QA

1. Done, as automated tests against the real ffprobe — WAV at two depths, AAC, FLAC, and a
   two-stream container, each with values known because this package wrote the source bytes.
2. Done: text, zip and truncated-WAV fixtures, each rejected with its own reason.
3. Done, without touching the system ffmpeg: a stand-in executable reports a build missing the
   AAC encoder, and `assertCapabilities` refuses to start against it.

Also verified live: `ffprobe` consumes a relative `-loglevel.wav` as an option ("Missing argument
for option 'loglevel.wav'") while an absolute or `./`-prefixed path parses, which is why the probe
resolves its input; and a child trapping SIGTERM is not reaped by `execFile`'s timeout.

## Rollback/compatibility

Additive package. Reverting breaks the media pipeline. **Note:** ffmpeg is a local prerequisite and is not present in every environment — record this in `README.md` prerequisites.

## Status

`complete`

## Commit

_(not yet)_
