# 051 — Upload session API

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Implement the server side of uploading: authorized session creation, part signing, and an idempotent finalize that verifies everything before creating an asset version.

## User value

Uploading a 2 GB master reliably, resumably, and without the file passing through a serverless function.

## Scope

- `upload_sessions`: expected owner, scope, object key, byte ceiling, MIME hint, checksum, part size, expiry, state.
- `upload_parts`: part number, ETag, size.
- `createUploadSession` — authorize, compute key and part size, create the session.
- `signUploadParts` — sign a batch of part URLs, short TTL, re-authorizing first.
- `completeUploadSession` — verify authorization, total size, part count, key ownership, and stored object; complete the multipart upload; create the storage object idempotently.
- `abortUploadSession` — abort the multipart upload and mark the session aborted.
- Magic-byte content typing, so what is recorded is what the bytes are.
- Expiry sweeping (the operational script referenced in `docs/OPERATIONS.md` §2).
- Audit events for every upload.

### Split: the HTTP endpoints moved to task `058`

The four `POST /api/uploads/**` routes were in this task's scope and are now task `058`, split
out **before coding** per CLAUDE.md §3 rather than silently dropped or improvised.

A route must turn a request into `{ userId, workspaceId }`. `apps/web/lib/auth/session.ts`
resolves a Clerk identity to `{ subject, userId }` (task `030`, `in-progress`), but nothing
resolves a **workspace** — that is task `031`, which is `pending`. Choosing how a request names
its workspace is a product decision affecting URLs, the macOS agent and share links; making it
here would commit the product to it by accident and force `031` to undo it.

What this task delivers is the protocol itself, complete and tested: `apps/web/lib/uploads/service.ts`
is the real implementation, not a stub, and `058` adds transport in front of it without adding
upload logic. `053` (client uploader) therefore depends on `058` as well as this task.

Enqueuing the media job also moves to `058`: there is no dispatcher until task `064`, and this
task will not fabricate one.

## Non-scope

- The HTTP endpoints (task `058`, split from this one — see above).
- The client uploader (task `053`).
- Browser folder upload (task `054`).
- Media processing (phase 6).

## Dependencies

`050`, `026`, `023`

## Files expected to change

```
packages/db/src/schema/uploads.ts
packages/db/migrations/0006_upload_sessions.sql
packages/contracts/src/uploads.ts
packages/db/src/ops/uploads-sweep.ts
packages/db/bin/uploads-sweep.mjs
apps/web/lib/uploads/service.ts
apps/web/lib/uploads/__tests__/**
packages/media/src/sniff.ts
packages/storage/src/driver.ts        (added `readPrefix`)
packages/storage/src/r2.ts            (implemented it)
docs/adr/0008-operational-scripts-may-compose-packages.md
```

Two files outside the original list. `packages/storage` gained a ranged read because content
typing cannot read magic bytes without one, and `packages/media` gained the sniffer because
format knowledge belongs there (`docs/ARCHITECTURE.md` §3) rather than in the web app. Both are
named here rather than added quietly.

## Implementation notes

- Finalize is the security-critical endpoint in the product. It must verify **every** property recorded at session creation against the actual stored object: the requester is the session owner, the destination is still authorized, the key is the one we issued, the size is within the ceiling, the part count is within limits, and the object actually exists in the bucket. A finalize that trusts the client's claims is an arbitrary-object-attachment vulnerability.
- Finalize must be idempotent: a replay returns the existing asset version rather than creating a duplicate (T4). Key idempotency on the session id.
- Never accept a client-supplied object key. The key comes from the session record, always.
- Cap part count. R2/S3 allow 10,000 parts; a session claiming far more is either broken or hostile.
- Derive content type from magic bytes for media rather than trusting the client's MIME hint.
- Sessions must expire, and expired sessions must be sweepable, or incomplete multipart parts accrue billed storage silently.

## Security/privacy considerations

The core of THREAT_MODEL T4. Controls: full property verification at finalize, idempotency, server-issued keys only, part-count caps, magic-byte content typing, session expiry, and authorization re-checked at finalize (not only at creation — a permission can be revoked mid-upload). Every upload is audited.

## Acceptance criteria

- [x] **Session creation authorizes the destination and records all expected properties.**
  - `refuses to open a session against an asset the subject may only view`
  - `refuses to open a session against an asset in another workspace`
  - `creates a version when everything checks out`
  - Mutation M6 (the shared guard never asks the authorizer) fails three tests by name; M7 (the
    guard drops its workspace filter) fails the IDOR test.

- [x] **Part URLs are signed with a short TTL and only for the session's own key.**
  - `never lets the client choose the destination`, `re-checks authorization at part signing too`
  - `createUploadSchema` has no key field, so a client naming a destination is not expressible.
  - Mutation M5 (signing skips the authorization re-check) fails its test by name.

- [x] **Finalize verifies requester, authorization, key ownership, size, part count, and object
      existence.**
  - `refuses a finalize from someone who is not the session owner`
  - `refuses a session from another workspace`
  - `refuses a part the store never saw`, `refuses a part whose ETag does not match what was stored`
  - `refuses when the object is not in the bucket afterwards`
  - `refuses a stored object larger than the ceiling`, `refuses claimed parts totalling more than
the ceiling`

- [x] **Finalize is idempotent; a replay returns the existing version and creates no duplicate.**
  - `is idempotent: a replay returns the first answer and creates nothing`

- [x] **A client-supplied key is rejected.**
  - `never lets the client choose the destination`

- [x] **Authorization is re-checked at finalize, and a revoked permission fails the finalize.**
  - `re-checks authorization, so a permission revoked mid-upload fails the finalize`
  - Mutation M4 (finalize skips the re-check) fails it by name.
  - **This criterion was twice met only on paper.** The first version of the test deleted the
    asset, so finalize failed on the asset lookup and passed identically with the re-check
    removed. The second shared one authorizer across both requests, which returned the
    creation-time answer from its cache. Both are recorded in the test's comments.

- [x] **Content type is derived from magic bytes for media.**
  - `records what the bytes are, not what the client said they were`
  - `stores an unrecognized file as an opaque download`, `reads only a prefix, never the whole object`
  - 24 further tests in `packages/media/src/sniff.test.ts`
  - Mutation M8 (read `head.contentType`, which is the client's own hint echoed back by R2)
    fails two tests by name.

- [x] **Expired sessions are sweepable and abort their multipart uploads.**
  - 13 tests in `packages/db/src/__tests__/uploads-sweep.test.ts`
  - Six mutations (W1–W6) each fail a test by name, including W6: marking a session expired when
    its abort failed, which strands billed parts where no later run will look.
  - Verified live against a seeded local database: the dry run named the abandoned session and
    not the live one; the real run refused without R2 credentials and left the row `pending`.

- [x] **Uploads are audited.**
  - `records the start and the completion of an upload`, `records an abort`
  - `never writes an object key into the log`, `records that the client misnamed the file`
  - `writes no event for a finalize that refused`
  - Mutations A1 (no completion event) and A2 (key in the metadata) each fail a test by name.

## What review found

Both reviewers were briefed with the diff and the mutations already run, and asked for what those
missed. Between them they found six defects that all gates had passed. Each is fixed here, and
each fix is pinned by a test that fails when the fix is reverted.

**The sweep was bound to the wrong bucket.** `bin/uploads-sweep.mjs` called `r2ConfigFrom(env)`
— a two-argument function — with one argument, which resolves to `'derivatives'`. The job would
have asked the derivatives bucket to abort uploads living in `originals`, received `NoSuchUpload`
for every one, left every session `pending`, and reclaimed nothing, while exiting non-zero with
errors that read like a transient R2 problem. The job whose entire purpose is to stop billed
parts accumulating would have accumulated them silently. **No gate could catch it**: `bin/**` is
not typechecked, the thirteen sweep tests inject the aborter, and the live run I did as evidence
failed for want of credentials — and its output named `R2_BUCKET_DERIVATIVES`, which I read
without noticing. Task `059` closes the hole.

**The object was minted with the client's own content type.** Sniffing at finalize fixed the
recorded column, but `createMultipart` was still passed `contentTypeHint`, and that is what R2
stores and serves the bytes back with. An uploader could have chosen `text/html` for a file we
later hand back under a presigned URL, no matter what the database said. Objects are now minted
`application/octet-stream`; task `067` supplies the true type at read time.

**`signUploadParts` validated nothing.** It was the only entry point taking its input raw, so
`signPartsSchema`'s bounds lived only in the schema's own unit test. One request could have
minted 50,000 hour-long write credentials.

**The idempotent-replay branch consulted no authorizer**, and its workspace predicate was the
only thing between a caller and another workspace's storage object — with nothing testing it.

**Three checks had no test that could fail.** Finalize's checksum comparison was unreachable
because every `scenario()` omitted `expectedChecksumSha256`; the replay branch's workspace
scoping was masked by an owner check that refused first; and the sweep's per-session `try/catch`
never had a second abortable session to continue to. All three are the CLAUDE.md §13 failure
mode again — not an empty fixture this time, but a fixture that never populates the one row that
makes the rule fire. That is now five instances in this build.

Also: the part TTL dropped from an hour to fifteen minutes, since an hour of write credentials
outlives the revocation check that signing exists to perform; `readPrefix` now refuses to buffer
a response that ignored its `Range` header; the zip signatures were stored as literal control
bytes, which `grep` and diffs render as a bare two-byte `PK` — the bytes were always right, but
both a reviewer and I read a bug that was not there, so they are escapes now with a test pinning
the behaviour; `abortUploadSession`'s deliberate lack of an edit check is written down rather
than left to be "fixed"; and `AUDIT_ACTION_INFO` credited these events to task `053`.

Two findings were handed on rather than folded in: task `059` (typecheck `bin/**`) and task
`067` (serve the recorded type). One was declined: the sweep emits no audit events, matching
`purge.ts`, and giving destructive system jobs an audited actor is a cross-cutting change that
should cover both.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/media test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/storage test
pnpm release-check
```

## Manual QA

Steps 1–4 need MinIO (task `052`) and the HTTP endpoints (task `058`), so they are **not done**
and this task does not claim them. Every control they would exercise has an automated test
against a stub driver that can be made to answer wrongly on purpose, which a real bucket cannot.

1. ~~Upload against MinIO through the real endpoints; confirm a version is created.~~ — `052`/`058`.
2. ~~Replay the finalize call; confirm the same version is returned and no duplicate exists.~~ — `052`/`058`.
3. ~~Revoke permission mid-upload and confirm finalize fails.~~ — `052`/`058`.
4. ~~Substitute another session's key at finalize and confirm rejection.~~ — `052`/`058`.

Done here instead:

5. The sweep, against a seeded local Postgres: `ops:uploads:sweep --dry-run` named the expired
   session and not the live one; the real run refused for want of R2 credentials and left the
   row `pending` rather than marking it.

**No byte has moved through the storage path yet.** Tasks `050` and `051` are both landing
without live verification against a real object store; `052` is where that happens, and it is
the first thing that should run after this.

## Rollback/compatibility

Additive. Reverting breaks uploading. Once sessions exist in production, schema changes follow expand/migrate/contract.

## Status

`complete`

## Commit

_(not yet)_
