# ADR 0002: Trigger.dev v3 with the FFmpeg build extension for media jobs

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

Finalized audio uploads need asynchronous processing: ffprobe validation, EBU R128 loudness
measurement, transcoding a streaming derivative, and generating waveform peaks. A 2 GB WAV
can take minutes. The work must be idempotent and retry-safe.

Vercel serverless functions cannot host this. Execution time limits, the absence of ffmpeg in
the runtime, and memory ceilings all rule it out. The build prompt directs us to Trigger.dev
with its FFmpeg extension unless a verified requirement forces a long-running worker.

## Decision

Use **Trigger.dev v3** with the `ffmpeg()` build extension, with task definitions in
`apps/jobs`.

The web app never imports Trigger.dev directly. It dispatches through a `JobDispatcher`
interface in `packages/media`:

```ts
interface JobDispatcher {
  enqueueAudioProcessing(input: AudioJobInput, idempotencyKey: string): Promise<JobHandle>;
}
```

Implementations: `TriggerDispatcher` (default), `InlineDispatcher` (tests, runs synchronously
against fixtures), and a documented seam for `WorkerDispatcher` should we ever need to
self-host.

## Consequences

**Easier:** Retries with backoff, concurrency limits, idempotency keys, long-running
execution, and a run dashboard all come for free. The `ffmpeg()` extension puts a real ffmpeg
binary in the deploy image, so `packages/media` runs identically in jobs and in local tests.
The free tier fits the prototype budget.

**Harder:** A third deploy target alongside Vercel and the Tauri agent. Local development
needs `pnpm --filter @youandfriends/jobs dev` running for jobs to execute, so the web app must
degrade legibly when the dispatcher is unreachable — a job row stays `queued` and the UI shows
"processing", never a fake success.

**Accepted:** Vendor coupling in `apps/jobs`. The `JobDispatcher` seam and the fact that all
real work lives in `packages/media` keep the blast radius to task definitions, not logic.

## Assumptions to re-verify

- Trigger.dev free tier run-count and duration limits accommodate a personal library's
  upload cadence.
- The `ffmpeg()` build extension ships a build with the encoders we need (`aac`, `libopus`)
  and the `ebur128` filter. Task `060` includes a startup capability probe that fails loudly
  rather than silently producing a broken derivative.
- Maximum task duration exceeds the worst-case 2 GB transcode.

## Alternatives considered

**Dedicated long-running worker** (`apps/worker` on Fly/Railway/Render) — full control over
the ffmpeg build and no per-run vendor limits, but we would hand-roll the queue, retries,
idempotency, backoff, observability, and autoscaling, and pay for an always-on container.
Reserved as the documented escape hatch if a Trigger.dev limit proves blocking; the repository
shape already anticipates `apps/worker`.

**Postgres-backed queue with `FOR UPDATE SKIP LOCKED`** — no extra vendor and pleasingly
simple, but still needs a host to run the consumer, which lands us back at the worker option
with more code to own.

**Inngest / QStash** — comparable job semantics, but neither offers a first-party ffmpeg
build path, so we would be back to sourcing a binary ourselves.
