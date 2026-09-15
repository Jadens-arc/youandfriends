# You & Friends — Threat Model

_A private music workspace by Avery and Friends._

Scope: the web app, the API surface, object storage, the realtime layer, and the macOS sync
agent. Reviewed per task by the `security-reviewer` agent; findings are fixed within the
originating task's scope.

## Assets, in priority order

1. **Unreleased music.** Masters, mixes, stems. Leakage is unrecoverable and is the worst
   outcome the product can produce.
2. **Unpublished lyrics.** Equally unrecoverable.
3. **Workspace membership and access structure.** Who collaborates with whom.
4. **Credentials.** Clerk sessions, sync tokens, R2 keys, database URL.
5. **Availability.** Important, but ranked below confidentiality throughout.

## Trust boundaries

| Boundary                   | Untrusted input crossing it        |
| -------------------------- | ---------------------------------- |
| Browser → route handler    | Every body, param, header, cookie  |
| Browser → R2 (presigned)   | Object bytes, part numbers, ETags  |
| Sync agent → API           | Sync token, manifest, snapshot ZIP |
| Liveblocks → API (webhook) | Room events, document snapshots    |
| Trigger.dev → API/R2       | Job results, derivative keys       |
| Share-link bearer → API    | Opaque link id, password attempt   |

Zod validates at every one of these. A boundary without a schema is a bug.

## Threats and controls

### T1 — Cross-workspace access (IDOR)

_Highest severity._ An authenticated member of workspace A reads or mutates a resource in
workspace B by guessing or substituting an ID.

**Controls.** Every tenant-owned row carries `workspace_id`. All reads go through
`scopedQuery` (ADR 0006), which pre-filters by the subject's workspace. A lint rule forbids
route handlers importing `db` without `authz`. Every sensitive resource class has an explicit
cross-workspace IDOR test (task `023`). Unauthorized access returns a **404-shaped** response,
not 403, so existence is not confirmed.

### T2 — Permission escalation through inheritance

A user granted viewer at song level gains editor because a broader folder grant was resolved
incorrectly, or a deny at a child is ignored.

**Controls.** Single resolution path. Most-specific-wins with explicit-deny override, tested
as an enumerated matrix across role × capability × scope depth. Permission changes take effect
on the next request and are propagated into active Liveblocks rooms (task `082`).

### T3 — Object storage exposure

An attacker obtains a permanent object URL, or a presigned URL leaks and remains valid.

**Controls.** Buckets are private with no public policy. Presigned URLs only after an authz
check, with short TTLs (streaming ~15 min, download ~5 min). Opaque ULID keys — never user
paths, so keys are not guessable from song titles. Presigned URLs are never logged and never
written into audit records.

### T4 — Upload abuse

Oversized objects, ZIP bombs, MIME spoofing, excessive multipart counts, path traversal in
manifest relative paths, orphaned sessions, replayed finalize calls, or substitution of
another workspace's object key at finalize.

**Controls.** `upload_sessions` record expected owner, scope, key, byte ceiling, MIME hint,
and expiry up front; finalize verifies **all** of them against the actual stored object and
refuses a key it did not issue. Finalize is idempotent — a replay returns the existing asset
version rather than creating a duplicate. Part counts are capped. Manifest relative paths are
normalized and rejected if they escape the root, are absolute, or contain traversal segments.
ZIPs are stored and checksummed but **never expanded server-side**, which removes the ZIP-bomb
class entirely. Content type is derived from magic bytes for media, never trusted from the
client. Orphan sweeps are documented in `docs/OPERATIONS.md`.

### T5 — Share-link abuse

Enumeration of opaque link IDs, brute-forcing a link password, or a link outliving its
intent.

**Controls.** Links are 128-bit random opaque IDs. Passwords are Argon2id-hashed, never
compared as plaintext. Rate limiting on link resolution and password attempts, with a
generic failure response that does not distinguish "wrong password" from "no such link".
Expiry and immediate revocation. Access events are logged with a per-link audit name and
without collecting unnecessary recipient data. A link **never** creates workspace membership
and resolves on a separate authorization path.

### T6 — Realtime room abuse

A user joins a lyrics room for a song they cannot read, or retains write access after
demotion.

**Controls.** Room tokens are minted server-side by `/api/liveblocks/auth` after the standard
authz check, scoped to one room with a role-appropriate capability set. Tokens are short-lived
so demotion takes effect on renewal; task `082` tests permission change mid-session
explicitly.

### T7 — Sync token compromise

A stolen laptop or leaked config yields workspace access.

**Controls.** Per ADR 0005: scoped to one workspace and an explicit destination allow-list,
append-only to Project Files, Argon2id-hashed at rest, macOS Keychain on device, never in
config files or logs, revocable instantly, with `last_used_at` visible in settings. A
recognizable `yaf_sync_` prefix makes the token findable by secret scanners.

### T8 — Destructive action and data loss

Accidental or malicious deletion.

**Controls.** Soft deletion with a recovery window on every user-visible entity. Purge jobs
run only after referential and retention checks. Originals are immutable — a new upload always
creates a version, never an overwrite. Lyric revisions are restorable. All destructive actions
are audited.

### T9 — Secret leakage into the repository

**Controls.** `.env.example` carries names and descriptions, never values. Secret scanning in
the quality gates. `CLAUDE.md` forbids committing credentials, generated uploads, local
databases, and user music. Fixtures are tiny generated tones — never real music.

## Explicit non-goals for iteration one

Stated plainly so they are not mistaken for oversights:

- **No end-to-end encryption.** The server can read stored media. E2EE is incompatible with
  server-side transcoding and waveform generation.
- **No protection against a malicious workspace owner.** Owners are trusted by design.
- **No DRM.** An authorized listener can record what they can hear.
- **No advanced availability engineering.** Provider outages degrade the product.

## Residual risks accepted

- Provider compromise (Clerk, Neon, R2, Liveblocks, Trigger.dev) exposes data.
- A compromised owner account exposes the workspace.
- Presigned URLs are bearer credentials for their TTL; a URL shared within its window works.
