# 053 — Client multipart uploader

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Build the browser uploader: chunking, parallel part uploads, progress, pause, resume across reload, cancel, retry with backoff, and checksum computation.

## User value

A 2 GB upload that survives a flaky connection, a closed laptop, and an accidental refresh.

## Scope

- Chunking with a part size chosen from file size, respecting the 5 MiB minimum and 10,000-part maximum.
- Bounded parallel part uploads with a concurrency limit.
- Accurate progress including per-part granularity.
- Pause and resume, including resume after a page reload, using persisted session state.
- Cancel that aborts the server session rather than merely stopping locally.
- Retry with exponential backoff and jitter on transient failures.
- Client-side checksum computation in a worker so the main thread stays responsive.

## Non-scope

- Upload UI (task `055`).
- Folder upload (task `054`).
- The Rust uploader in the Mac agent (task `115`), which mirrors this logic.

## Dependencies

`051`

## Files expected to change

```
apps/web/lib/upload/{uploader,chunker,checksum.worker,persistence}.ts
apps/web/lib/upload/__tests__/**
packages/contracts/src/uploads.ts
```

## Implementation notes

- Compute checksums in a Web Worker. Hashing 2 GB on the main thread freezes the tab, and a frozen tab during a long upload reads as a crash.
- Persist session state (session id, part progress) in IndexedDB so a reload resumes rather than restarting. This is the difference between resumable in principle and resumable in practice.
- Concurrency must be bounded — unbounded parallel parts saturate the connection and make progress reporting useless. Four to six concurrent parts is a reasonable starting point, and it should be configurable.
- Retry only transient failures. Retrying a 403 forever hides an authorization problem behind an apparently stalled upload.
- Part size selection: a 2 GB file at 5 MiB parts is 400 parts, which is fine. Scale part size up for large files rather than approaching the part limit.
- Cancel must call the server abort endpoint. A local-only cancel leaves billed incomplete multipart storage behind (`docs/OPERATIONS.md` §2).

## Security/privacy considerations

The client is untrusted; all enforcement lives server-side in task `051`. The uploader must never receive or persist long-lived credentials — only short-TTL part URLs, refetched when they expire mid-upload. Persisted IndexedDB state must contain no presigned URLs, since it outlives their TTL and sits on disk.

## Acceptance criteria

- [ ] Files are chunked with a valid part size respecting minimum and maximum limits.
- [ ] Part uploads run with bounded concurrency.
- [ ] Progress is accurate and updates smoothly.
- [ ] Pause and resume work, including across a page reload.
- [ ] Cancel aborts the server session.
- [ ] Transient failures retry with backoff; non-transient failures surface immediately.
- [ ] Checksums compute in a worker without blocking the main thread.
- [ ] Persisted state contains no presigned URLs.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/storage test:contract
```

## Manual QA

1. Upload a large file, reload mid-upload, confirm it resumes.
2. Disconnect the network mid-upload, reconnect, confirm retry succeeds.
3. Cancel an upload and confirm the server session is aborted.

## Rollback/compatibility

Additive client code. Reverting breaks uploading from the browser.

## Status

`pending`

## Commit

_(not yet)_
