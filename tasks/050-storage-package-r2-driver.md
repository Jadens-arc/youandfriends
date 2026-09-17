# 050 — Storage package and R2 driver

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Implement `packages/storage`: a `StorageDriver` interface with a Cloudflare R2 implementation via the S3 API, covering presigning, multipart operations, and lifecycle, with S3 and MinIO substitutable.

## User value

Music is stored durably and privately, and served fast without the bytes ever passing through the web host.

## Scope

- `StorageDriver` interface: `createMultipart`, `signPart`, `listParts`, `completeMultipart`, `abortMultipart`, `signDownload`, `signStream`, `head`, `delete`.
- R2 driver over the AWS SDK v3 S3 client (ADR 0001).
- Opaque key generation: `w/<workspaceId>/o/<ulid>`, with separate prefixes for originals and derivatives.
- Short presigned TTLs: streaming ~15 minutes, download ~5 minutes, part upload ~1 hour, all configurable.
- Bucket configuration for two private buckets with no public policy.
- A MinIO-backed driver configuration for local development and contract tests.

## Non-scope

- The upload session API (task `051`) — this is the storage layer only.
- Media processing (phase 6).
- Lifecycle rules in the R2 console (documented in `docs/OPERATIONS.md`, not code).

## Dependencies

`002`, `003`

## Files expected to change

```
packages/storage/src/{driver,r2,keys,presign,index}.ts
packages/storage/src/__tests__/**
.env.example
docs/OPERATIONS.md
```

## Implementation notes

- Keys are opaque ULIDs. A user path never becomes a key — path traversal, information disclosure through key names, and collision are all avoided at once (T3, T4).
- Presigned URLs are bearer credentials. They must never be logged, never stored in audit metadata, and always have the shortest workable TTL.
- Originals and derivatives use distinct key prefixes so lifecycle rules can differ — derivatives are regenerable and may be purged aggressively; originals never are.
- R2's multipart semantics are close to S3 but not identical. Do not assume; task `052`'s contract tests pin exactly what we rely on.
- The driver must be stateless and injectable so tests can substitute MinIO without environment gymnastics.

## Security/privacy considerations

This package is the control surface for THREAT_MODEL T3. Buckets are private with no public policy — assert this in a startup check rather than trusting console configuration. Presigned URLs are issued only by callers that have already run an authz check; the driver itself performs no authorization and must never be exposed directly to a route.

## Acceptance criteria

- [ ] Every `StorageDriver` method is implemented for R2 and works against MinIO.
- [ ] Keys are opaque ULIDs with separate prefixes for originals and derivatives.
- [ ] Presigned TTLs are short and configurable.
- [ ] Presigned URLs never appear in logs or audit metadata, proven by test.
- [ ] A startup check fails loudly if a bucket is publicly readable.
- [ ] The driver is injectable and stateless.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/storage test
pnpm --filter @youandfriends/config test
```

## Manual QA

1. Run against MinIO, upload a multipart object, download it via a presigned URL.
2. Wait out a presigned TTL and confirm the URL stops working.
3. Make a test bucket public and confirm the startup check fails.

## Rollback/compatibility

Additive package. Reverting breaks all upload and playback tasks.

## Status

`pending`

## Blocker

Docker is unavailable in this environment, so MinIO cannot run — and the acceptance criterion
reads "works against MinIO", not "compiles". The driver could be written here and the
verification could not, which would mean claiming a storage layer nobody has seen move bytes.
Passed over rather than half-done; task `100` taken in its place. Needs either Docker, or a
decision to verify against real R2 with credentials.

## Commit

_(not yet)_
