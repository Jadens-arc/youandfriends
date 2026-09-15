# ADR 0001: Cloudflare R2 for object storage

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

You & Friends stores lossless audio masters, stems, and arbitrary project archives: up to
2 GB per object and roughly 100 GB for the initial workspace. Media is read repeatedly for
streaming and occasionally downloaded in full. The prototype must operate under $25/month.

Egress is the dominant cost risk in media products. A workspace that streams its own catalog
regularly can move many times its stored volume per month.

## Decision

Use **Cloudflare R2** through its S3-compatible API as the default object store, behind a
`StorageDriver` interface in `packages/storage` so AWS S3 (or MinIO in tests) can be
substituted without touching call sites.

- Buckets are private. No public bucket policy, ever.
- All client access uses short-lived presigned URLs issued only after an authz check.
- Object keys are opaque: `w/<workspaceId>/o/<ulid>`. User paths are metadata, never keys.
- Originals and derivatives live under separate key prefixes with different lifecycle rules.

## Consequences

**Easier:** Egress is not billed, so streaming and A/B version comparison do not create a
cost cliff. Storage at $0.015/GB-month puts 100 GB near $1.50/month. The S3 API means the
AWS SDK, presigning, and multipart upload all work unchanged, and MinIO serves as a faithful
local test double.

**Harder:** R2 is a separate vendor from the database and web host, so credential rotation
and reconciliation are our responsibility (see `docs/OPERATIONS.md`). R2's consistency and
multipart semantics are close to S3 but not identical; the storage contract tests in task
`052` pin the behavior we depend on.

**Accepted:** A second provider account is required for local development. Contributors
without R2 credentials run against MinIO.

## Assumptions to re-verify

These were taken from vendor documentation at authoring time and **were not independently
verified against live provider limits**. Re-check before relying on any of them in
production, and at minimum once per quarter:

| Assumption                                             | Why it matters                             |
| ------------------------------------------------------ | ------------------------------------------ |
| R2 standard storage ≈ $0.015/GB-month                  | The entire cost model                      |
| R2 egress to internet is not billed                    | Streaming economics                        |
| R2 multipart part size minimum 5 MiB, max 10,000 parts | Upload chunking math in task `050`         |
| R2 max object size ≥ 5 TiB                             | Our 2 GB ceiling is far below, but confirm |
| Presigned URL max TTL ≥ 1 hour                         | Download/stream URL lifetime               |

Quotas are configurable via `YOUANDFRIENDS_MAX_OBJECT_BYTES` and
`YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES` rather than hard-coded, so a limit change is a config
edit and not a code change.

## Alternatives considered

**AWS S3** — the reference implementation and operationally excellent, but egress at roughly
$0.09/GB makes regular streaming of a 100 GB library unpredictable and potentially far over
budget. Kept as a first-class substitutable driver.

**Vercel Blob** — tightest integration with the web host, but pricing per GB stored and
transferred is higher for media volumes, and the multipart/presigning story is less flexible
than the S3 API.

**Backblaze B2** — competitive storage pricing and free egress to Cloudflare, but the
S3-compatible surface is smaller and we would gain a second hop for no benefit over R2.
