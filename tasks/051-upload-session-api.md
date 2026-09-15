# 051 — Upload session API

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Implement the server side of uploading: authorized session creation, part signing, and an idempotent finalize that verifies everything before creating an asset version.

## User value

Uploading a 2 GB master reliably, resumably, and without the file passing through a serverless function.

## Scope

- `upload_sessions`: expected owner, scope, object key, byte ceiling, MIME hint, checksum, part size, expiry, state.
- `upload_parts`: part number, ETag, size.
- `POST /api/uploads` — authorize, compute key and part size, create the session.
- `POST /api/uploads/:id/parts` — sign a batch of part URLs, short TTL.
- `POST /api/uploads/:id/complete` — verify authorization, total size, part count, key ownership, and stored object; complete the multipart upload; create the asset version idempotently; enqueue the media job.
- `POST /api/uploads/:id/abort` — abort the multipart upload and mark the session aborted.
- Expiry sweeping (the operational script referenced in `docs/OPERATIONS.md` §2).

## Non-scope

- The client uploader (task `053`).
- Browser folder upload (task `054`).
- Media processing (phase 6) — this task only enqueues.

## Dependencies

`050`, `026`, `023`

## Files expected to change

```
packages/db/src/schema/uploads.ts
apps/web/app/api/uploads/**
packages/contracts/src/uploads.ts
packages/db/src/ops/uploads-sweep.ts
apps/web/app/api/uploads/__tests__/**
```

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

- [ ] Session creation authorizes the destination and records all expected properties.
- [ ] Part URLs are signed with a short TTL and only for the session's own key.
- [ ] Finalize verifies requester, authorization, key ownership, size, part count, and object existence.
- [ ] Finalize is idempotent; a replay returns the existing version and creates no duplicate.
- [ ] A client-supplied key is rejected.
- [ ] Authorization is re-checked at finalize, and a revoked permission fails the finalize.
- [ ] Content type is derived from magic bytes for media.
- [ ] Expired sessions are sweepable and abort their multipart uploads.
- [ ] Uploads are audited.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/storage test
```

## Manual QA

1. Upload against MinIO through the real endpoints; confirm a version is created.
2. Replay the finalize call; confirm the same version is returned and no duplicate exists.
3. Revoke permission mid-upload and confirm finalize fails.
4. Substitute another session's key at finalize and confirm rejection.

## Rollback/compatibility

Additive. Reverting breaks uploading. Once sessions exist in production, schema changes follow expand/migrate/contract.

## Status

`pending`

## Commit

_(not yet)_
