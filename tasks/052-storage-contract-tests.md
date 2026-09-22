# 052 — Storage contract tests against MinIO

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Pin the exact storage behavior we depend on with contract tests running against a local S3-compatible service, so a provider difference surfaces in CI rather than in production.

## User value

Uploads that work in development keep working in production, and a provider change is a known quantity.

## Scope

- A MinIO service in the test environment, started and torn down by the harness. **This is
  where the driver is first run against a real server at all**: task `050` builds it, and the
  criterion there that read "works against MinIO" was this task written twice. So a green `050`
  does not mean any byte has moved — that claim starts here.
- Contract tests for every `StorageDriver` method.
- Multipart edge cases: minimum part size, maximum part count, out-of-order parts, re-uploading a part, aborting mid-upload, completing with a missing part.
- Presigned URL expiry behavior.
- Checksum and ETag semantics we rely on.
- The suite wired into `release-check` and skipped with a clear message when MinIO is unavailable, never silently passed.

## Non-scope

- Testing against real R2 in CI — credentials do not belong in CI for a personal prototype.
- Performance or throughput benchmarking.
- Multi-region behavior.

## Dependencies

`050`, `051`

## Files expected to change

```
packages/storage/src/__tests__/contract/**
packages/storage/src/__tests__/minio-harness.ts
packages/storage/src/__tests__/minio-runner.ts
docker-compose.test.yml
scripts/release-check.mjs
```

## Implementation notes

- A skipped test must be loudly skipped. A contract suite that silently passes when MinIO is down is worse than no suite, because it produces false confidence.
- MinIO is not R2. Document which behaviors are verified against MinIO and which remain assumptions about R2 — ADR 0001's assumption register is the place to record the gap.
- Test the failure cases specifically: completing with a missing part, re-uploading a part after completion, aborting an already-completed upload. These are the paths that break in production and never in a happy-path test.
- Keep the harness fast; a contract suite that takes minutes gets skipped by developers regardless of what the docs say.

## Security/privacy considerations

These tests verify controls from T4 at the storage layer: part-count limits, key isolation between sessions, and presigned expiry. The suite includes a negative test that one session's presigned part URL cannot write to another session's key.

## Acceptance criteria

- [x] MinIO starts and stops via the test harness.
- [x] Every driver method has a contract test.
- [x] Multipart edge cases and failure paths are covered.
- [x] Presigned expiry is verified.
- [x] A presigned URL for one key cannot write to another key.
- [x] The suite is in `release-check` and skips loudly when MinIO is unavailable.
- [x] Verified-versus-assumed behaviors are recorded in ADR 0001.

## Tests and validation commands

```bash
docker compose -f docker-compose.test.yml up -d
pnpm --filter @youandfriends/storage test:contract
pnpm release-check
```

## Manual QA

1. Stop MinIO and confirm the suite skips loudly rather than passing.
2. Review the verified-versus-assumed table in ADR 0001 for honesty.

Done: the managed release-check runner started the pinned Compose service, waited for health, ran
all ten tests, and removed the container, network, bucket, and ephemeral data in `finally`. With the
service stopped, a direct run reported one skipped file and ten skipped tests after printing
`MINIO CONTRACT TESTS SKIPPED` with the exact start command. ADR 0001 names MinIO as evidence only
for the pinned image and keeps every live-R2 behavior in the assumption column. Managed runs
override caller endpoint and credential variables and require the service, so they cannot turn an
endpoint override or a failed startup into a passing skipped suite.

## Rollback/compatibility

Test-only. Reverting removes the guard that makes storage changes safe.

## Status

`complete`

## Commit

`dae8638`
