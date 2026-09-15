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

## Acceptance criteria

- [ ] ffprobe extracts duration, codec, channels, sample rate, and bit depth, parsed with Zod.
- [ ] Non-media and corrupt files are rejected with a clear reason.
- [ ] The capability probe fails loudly when a required encoder or filter is missing.
- [ ] `JobDispatcher` has Trigger and Inline implementations; the pipeline itself is never mocked.
- [ ] No shell interpolation of user-controlled values.
- [ ] Jobs have enforced timeouts and bounded temporary disk use.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/media test
ffmpeg -version   # local prerequisite
```

## Manual QA

1. Probe each generated fixture format and confirm correct metadata.
2. Feed a text file renamed to `.wav`; confirm clean rejection.
3. Remove an encoder from the environment and confirm the probe fails loudly.

## Rollback/compatibility

Additive package. Reverting breaks the media pipeline. **Note:** ffmpeg is a local prerequisite and is not present in every environment — record this in `README.md` prerequisites.

## Status

`pending`

## Commit

_(not yet)_
