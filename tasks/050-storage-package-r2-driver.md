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
- A MinIO-backed driver _configuration_ — the environment shape a MinIO endpoint plugs into.

**Split out:** standing MinIO up and running the driver against it moves to task `052`, which is
named "Storage contract tests" and whose scope already reads "a MinIO service in the test
environment, started and torn down by the harness" and "contract tests for every
`StorageDriver` method". The criterion here said "works against MinIO", which was that task
written twice.

The occasion for noticing was environmental — Docker is unavailable here and `dl.min.io` is
blocked — but the duplication was real either way, and the user chose this over substituting a
JavaScript S3 reimplementation for the real server. A contract test against a fake proves what
the fake does.

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

- [x] Every `StorageDriver` method is implemented for R2. **Verification against a running
      server is task `052`** — see the split under Scope. Nothing here has moved a byte, and the
      package doc says so in the first paragraph rather than leaving it to be discovered.
- [x] Keys are opaque and server-generated, with distinct prefixes per class.
      A key carries nothing a caller supplied — asserted by reconstructing the whole key from
      its three server-generated parts. `listParts` paginates, because an upload can have 10,000
      parts and reading one page would silently lose the tail of a large upload.
- [x] Presigned TTLs are short and configurable, download shorter than stream.
      A download URL that reaches someone else's chat is a copy of the file; a stream URL has to
      outlive a long track on a poor connection. Every lifetime is bounded and tested.
- [x] Bucket configuration for two private buckets, with a startup check.
      `assertBucketPrivate` asks the bucket rather than trusting that somebody set it in the
      console. Any policy at all is reported rather than parsed — a parser deciding which public
      policies are benign is one that will eventually be wrong about unreleased music.
- [x] The driver performs no authorization and is not reachable from a route.
      Stated in the package doc, and the surface test asserts no S3 client or signer is
      re-exported — a caller reaching past the driver could sign anything with none of the key
      or TTL policy applied.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/storage test
pnpm --filter @youandfriends/config test
```

## Manual QA

1. Run against MinIO, upload a multipart object, download it via a presigned URL.

**Not done, and not doable here**: Docker is unavailable and `dl.min.io` is blocked by this
environment's network policy. This is the manual QA of task `052`, which owns the MinIO harness.
Until it runs, the honest claim about this package is that it compiles and its logic is tested —
not that it works.

## Rollback/compatibility

Additive package. Reverting breaks all upload and playback tasks.

## Status

`in-progress`

## Commit

_(not yet)_
