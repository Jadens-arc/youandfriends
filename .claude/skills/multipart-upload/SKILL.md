---
name: multipart-upload
description: Implement and verify the create/sign/upload/list-parts/complete/abort/finalize cycle. Use for any change to the upload protocol, in the browser or the Mac agent.
---

# Multipart upload

Finalize is the most security-critical endpoint in the product. This procedure covers the full
cycle and what must be verified at each step.

## When to use

Any change to upload session handling, part signing, finalization, or either client uploader.

## The cycle

```
create → sign parts → PUT parts (direct to R2) → complete → finalize
                                              ↘ abort
```

## Steps

### 1. Create

The session records **expected** properties up front: owner, scope, object key, byte ceiling,
MIME hint, part size, expiry. These are what finalize verifies against later.

- Authorize the destination **now**.
- Generate the key server-side: `w/<workspaceId>/o/<ulid>`. Never accept a client key.
- Choose part size from file size: ≥5 MiB, ≤10,000 parts, scaling up for large files.

### 2. Sign parts

- Short TTL (~1 hour), only for this session's key.
- A signed URL for one session must not be usable for another session's key. This is tested
  explicitly in the contract suite.

### 3. Upload parts

Bytes go **direct to R2**. Never through a Vercel function.

Client requirements: bounded concurrency, progress, pause, resume across reload, retry with
backoff on transient failures only, checksum in a worker.

### 4. Complete and finalize

Verify **every** one of these. Missing any turns finalize into an arbitrary-object-attachment
vulnerability:

- [ ] The requester owns the session.
- [ ] The destination is **still** authorized — permissions can be revoked mid-upload.
- [ ] The object key is the one we issued.
- [ ] Total size is within the recorded ceiling.
- [ ] Part count is within limits.
- [ ] The object actually exists in the bucket (`head`).
- [ ] Content type is derived from magic bytes for media, not the client's claim.

Then, idempotently: complete the multipart upload, create the asset version, enqueue the media
job. A replayed finalize returns the **existing** version and creates no duplicate.

### 5. Abort

Cancel must call the server abort endpoint, which aborts the R2 multipart upload. A local-only
cancel leaves billed incomplete parts behind (`docs/OPERATIONS.md` §2).

### 6. Verify

```bash
docker compose -f docker-compose.test.yml up -d
pnpm --filter @youandfriends/storage test:contract
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

Test the failure paths specifically: missing part at complete, replayed finalize, substituted
key, revoked permission mid-upload, expired session, oversized object.

## Stop conditions

- Any finalize verification cannot be performed.
- Finalize cannot be made idempotent.
- The contract suite cannot run (MinIO unavailable) — it must skip **loudly**, and a change to
  the protocol should not ship unverified.
- R2 behavior differs from the contract assumptions — update ADR 0001's assumption register.

## Output

```
CHANGE: <summary>
KEY: server-issued opaque — verified
PART SIZE: <size> (min 5 MiB, max 10,000 parts) — verified
FINALIZE VERIFICATIONS: requester|authz|key|size|parts|existence|content-type — all checked
IDEMPOTENCY: replay returns existing version — verified
ABORT: server session aborted — verified
FAILURE PATHS TESTED: <list>
CONTRACT TESTS: pass|fail|skipped-loudly
```
