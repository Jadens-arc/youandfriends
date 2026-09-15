# You & Friends — Architecture

_A private music workspace by Avery and Friends._

This document describes how **You & Friends** is built. `docs/DESIGN.md` is authoritative for
product behavior and visual design; this document is authoritative for engineering structure.
Decisions with meaningful trade-offs are recorded as ADRs in `docs/adr/`.

## 1. System overview

```text
                        ┌──────────────────────────────────────────┐
   iPhone / Mac ───────▶│  apps/web  — Next.js App Router (Vercel) │
   browser (PWA)        │  RSC + route handlers + server actions   │
                        └───┬───────────────┬──────────────┬───────┘
                            │               │              │
              authn/session │      metadata │      signed  │ realtime
                            ▼               ▼      URLs +  ▼ rooms
                        ┌────────┐   ┌────────────┐  ┌──────────────┐
                        │ Clerk  │   │ Neon       │  │ Liveblocks   │
                        │        │   │ Postgres   │  │ (Yjs transport)
                        └────────┘   │ + Drizzle  │  └──────────────┘
                                     └─────┬──────┘
                                           │ job enqueue (idempotency key)
                                           ▼
                                  ┌──────────────────┐
                                  │ Trigger.dev v3   │
                                  │ + ffmpeg ext.    │
                                  └────────┬─────────┘
                                           │ GET original / PUT derivatives
   ┌───────────────────┐                   ▼
   │ apps/sync-mac     │        ┌────────────────────────────┐
   │ Tauri 2 menu bar  │───────▶│ Cloudflare R2 (S3 API)     │
   │ watch → zip →     │  multi │ originals (immutable)      │
   │ multipart upload  │  part  │ derivatives (regenerable)  │
   └───────────────────┘        └────────────────────────────┘
```

**Bytes never pass through Vercel.** Clients obtain short-lived signed URLs and talk to R2
directly. Vercel functions only sign, authorize, and record.

## 2. Repository shape

```text
/
├── CLAUDE.md                  # agent operating rules
├── README.md
├── .env.example               # names + descriptions, never values
├── .claude/                   # agents, skills, commands, settings
├── tasks/                     # the complete numbered plan + STATUS.md
├── docs/                      # DESIGN, ARCHITECTURE, THREAT_MODEL, OPERATIONS, adr/
├── apps/
│   ├── web/                   # Next.js App Router — the product
│   ├── jobs/                  # Trigger.dev task definitions (deployed separately)
│   └── sync-mac/              # Tauri 2 macOS menu-bar sync agent
└── packages/
    ├── config/                # shared tsconfig / eslint / tailwind preset / env schema
    ├── contracts/             # Zod schemas + shared types at every trust boundary
    ├── db/                    # Drizzle schema, migrations, client
    ├── authz/                 # the single source of permission truth
    ├── storage/               # S3-compatible driver interface (R2 default)
    ├── media/                 # ffprobe/ffmpeg orchestration, waveform peaks, job contracts
    └── ui/                    # Studio Notebook design system on shadcn primitives
```

`/tasks` is the plan and state machine. It is never the source directory. Application code
stays in `apps/` and `packages/`.

## 3. Package responsibilities and dependency direction

Dependencies point inward. `ui` and `web` may depend on `contracts`; `contracts` depends on
nothing in the repo. `authz` depends on `db` and `contracts` only.

| Package                    | Owns                                                               | May import             | Must not import          |
| -------------------------- | ------------------------------------------------------------------ | ---------------------- | ------------------------ |
| `@youandfriends/config`    | tsconfig bases, eslint flat config, tailwind preset, `env` parsing | —                      | anything                 |
| `@youandfriends/contracts` | Zod schemas, DTOs, error codes, role/capability enums              | `config`               | `db`, `storage`, React   |
| `@youandfriends/db`        | Drizzle schema, migrations, typed client, transaction helper       | `contracts`, `config`  | `authz`, `web`           |
| `@youandfriends/authz`     | permission resolution, capability checks, audit emission           | `db`, `contracts`      | `web`, `storage`         |
| `@youandfriends/storage`   | `StorageDriver` interface, R2/S3 driver, signing, multipart        | `contracts`, `config`  | `db`, `authz`            |
| `@youandfriends/media`     | ffprobe parsing, loudness, derivative recipes, peak generation     | `contracts`, `storage` | `db`, `web`              |
| `@youandfriends/ui`        | tokens, primitives, Studio Notebook components                     | `contracts`, `config`  | `db`, `authz`, `storage` |

A lint rule enforces that no route handler imports `db` without going through `authz` for
tenant-scoped reads. See task `022`.

## 4. Data model outline

Every tenant-owned row carries `workspace_id`. Full schema lives in `packages/db/src/schema/`.

**Identity and tenancy** — `users` (Clerk `user_id` mapping), `workspaces`,
`workspace_memberships`, `invitations`, `sync_devices`, `sync_tokens`.

**Content hierarchy** — `folders` (nestable, materialized `path` for safe subtree queries),
`projects`, `songs`, `favorites`.

**Files and versions** — `assets` (logical file: kind, name, tags, folder placement within
Project Files), `asset_versions` (immutable; one storage object each), `storage_objects`
(bucket, opaque key, size, checksum, content type), `mix_versions` (ordered version stack per
song with a `current_version_id` pointer on `songs`), `derivatives` (streaming audio, waveform
peaks, thumbnails — all regenerable).

**Folder snapshots** — `snapshots` (immutable once finalized, from browser folder upload or
Mac agent), `snapshot_entries` (relative path, size, mtime, checksum, ignored flag).

**Uploads** — `upload_sessions` (expected owner/scope, object key, byte limit, MIME hint,
checksum, expiry, state), `upload_parts` (part number, ETag, size).

**Jobs** — `media_jobs` (idempotency key, state, attempt count, last error, timings).

**Lyrics** — `lyrics_documents` (canonical Tiptap JSON snapshot + searchable plain text +
Yjs state vector), `lyrics_revisions` (automatic and user-named checkpoints, restorable).

**Discussion** — `comment_threads` (anchor: general | audio timestamp | lyric range),
`comments`, `comment_reactions`, `comment_mentions`; voice notes are `assets` of kind
`voice_note` referenced by a comment.

**Access** — `permission_grants` (scope type folder/project/song, scope id, subject, role,
`can_download`, `can_invite`, `is_deny`), `share_links` (opaque id, target, policy, password
verifier, expiry, revoked_at), `share_link_accesses`.

**System** — `notifications`, `notification_preferences`, `audit_events`, soft-delete columns
(`deleted_at`, `deleted_by`, `purge_after`) on every user-visible entity.

## 5. Permission resolution

Implemented once in `packages/authz`, never inline in routes.

1. Resolve the subject: workspace member, share-link bearer, or anonymous.
2. Build the **scope chain** for the target, from most to least specific:
   `song → project → folder → …ancestors… → workspace`.
3. Collect active grants (not revoked, not expired) matching the subject at any chain level.
4. The **most specific** grant wins. An explicit deny at any level beats an inherited allow
   from a less specific level.
5. Capabilities `can_download` and `can_invite` are independent booleans resolved the same way.
6. Share-link access is evaluated in a separate path and never creates workspace membership.
7. Every access-changing action writes an `audit_events` row in the same transaction.

The matrix is executable: `packages/authz/src/__tests__/matrix.test.ts` enumerates
(role × capability × scope depth × deny-override) and every sensitive resource class has a
cross-workspace IDOR test. See task `023`.

## 6. Upload and storage flow

```text
client                    web (Vercel)               R2                 Trigger.dev
  │  POST /api/uploads ──────▶ authz check
  │                           create upload_session
  │  ◀── sessionId, key, partSize
  │  POST /api/uploads/:id/parts ──▶ sign part URLs (short TTL)
  │  ◀── signed URLs
  │  PUT part 1..N ───────────────────────────▶ (bytes go direct)
  │  POST /api/uploads/:id/complete ─▶ verify authz, size,
  │                                    part count, checksum
  │                                    CompleteMultipartUpload ─▶
  │                                    create asset_version (idempotent)
  │                                    enqueue media job ───────────────▶ process
  │  ◀── asset, version, job state
```

Finalization is **idempotent**: a repeated complete call with the same session returns the
existing asset version rather than creating a duplicate. Object keys are opaque
(`w/<workspace>/o/<ulid>`), never derived from user paths.

## 7. Media pipeline

Idempotent, retry-safe, keyed on `asset_version_id`:

1. Download the private original to isolated temp storage.
2. `ffprobe` → duration, codec, channels, sample rate, bit depth. Reject non-media.
3. EBU R128 integrated loudness + true peak via ffmpeg `loudnorm`/`ebur128`.
4. Transcode a streaming derivative — **AAC in fMP4** (see ADR 0004).
5. Generate multi-resolution waveform peaks as compact binary.
6. Upload derivatives to private R2 keys.
7. Transactionally update status and emit notifications.
8. Clean temp data; retries never duplicate derivative rows.

Arbitrary project files (Logic, MPC, ZIP, MIDI) are **never transcoded** — only stored,
checksummed, and listed.

## 8. Real-time lyrics

Tiptap document → Yjs `Y.Doc` → Liveblocks room (`lyrics:<songId>`). Liveblocks provides the
websocket transport Vercel functions cannot hold open. Room access is authorized server-side:
the client requests a room token from `/api/liveblocks/auth`, which runs the same `authz`
check as any other route and issues a scoped token.

Postgres holds the canonical record — a debounced snapshot (Tiptap JSON + plain text
projection for search + Yjs state vector) written on idle, on blur, and on lifecycle events.
Revisions are snapshotted automatically on a cadence and on explicit user checkpoints.

## 9. Environments and configuration

`packages/config/src/env.ts` parses `process.env` with Zod at startup and fails loudly on a
missing required variable. Product-specific variables use the `YOUANDFRIENDS_` prefix;
provider SDKs keep their conventional names (`CLERK_SECRET_KEY`, `DATABASE_URL`, …).
Observability hooks are no-ops when no Sentry DSN is configured — never a crash, never a
silent swallow.

## 10. Quality gates

Run by `pnpm release-check` and in CI:

format → lint → typecheck (strict) → unit → db/authz integration → storage contract
(MinIO) → media fixture → Rust clippy + tests → Playwright (desktop + iPhone viewport) →
`next build` → migration dry run → dependency + secret scan.

## 11. Cost model

Target: under **$25/month** at ~100 GB.

| Service       | Tier                            | Est. monthly |
| ------------- | ------------------------------- | ------------ |
| Vercel        | Hobby                           | $0           |
| Neon          | Free (metadata only)            | $0           |
| Clerk         | Free ≤10k MAU                   | $0           |
| Cloudflare R2 | 100 GB @ $0.015/GB, zero egress | ~$1.50       |
| Liveblocks    | Free tier                       | $0           |
| Trigger.dev   | Free tier                       | $0           |
| **Total**     |                                 | **~$1.50–5** |

Quotas are configurable (`YOUANDFRIENDS_MAX_OBJECT_BYTES`, `YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`)
rather than hard-coded. Provider limits were not independently verified at authoring time —
see ADR 0001 for the assumption register and re-verification procedure.
