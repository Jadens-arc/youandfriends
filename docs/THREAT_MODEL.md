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

### T10 — Operator tooling and environment targeting

Every threat above assumes a request: a subject, a workspace, an authorizer between them. The
command-line tools in `packages/db/bin/` have none of those. They are run by a person at a
shell, they hold unrestricted credentials, and they are the only code that can empty a
workspace in one command. Nothing in T1–T9 covers them, and the gap is not theoretical: the
first version of the seed would have written fabricated users, workspaces and permission grants
into production, from an ordinary development shell, and passed every check it had.

**The environment label is not the target.** `NODE_ENV=development` says where a process thinks
it is running, not what it is about to write to. A developer debugging an incident puts a
production connection string in `.env.local` — that is what the file is for — and the label
stays `development` all the while.

**Controls.** A CLI that writes to, or deletes from, a database must:

1. **Validate its target, not just its environment.** Read the host out of the connection string
   and decide about _that_. Where a tool must never touch production, local is the default and
   anything else is named explicitly by the operator in an environment variable. Where a tool is
   _meant_ to run against production — a migration is — the control is announcement and
   confirmation rather than refusal.
2. **Say what it is about to write to, before it writes.** One line naming the host. An operator
   who has two shells open has no other way to tell them apart, and this is the cheapest control
   in this document.
3. **Delete by identifier, not by predicate.** A `WHERE workspace_id = …` sweep takes rows the
   tool did not create — a developer's own work, sitting in the same workspace. Compute the ids
   and delete those.
4. **Run in one transaction.** A delete that a trigger refuses partway through leaves a state
   that cannot be cleared by running the tool again, because it fails at the same row every
   time.
5. **Fail closed on every dimension it checks.** An unset variable is a refusal, not an
   assumption. The obvious shape — "refuse if `NODE_ENV` is production" — permits an unset one,
   which is exactly what a hastily-opened shell has.
6. **Make the guard unskippable by construction where it can.** `packages/db/src/seed/guard.ts`
   is the worked example: `assertSeedAllowed` returns a branded permit, and `seed` and `reset`
   require one, so no code path reaches them having skipped the check. Containment by type
   beats containment by which symbols happen to be exported today.

**Compliance, audited (task `006`).**

| Tool          | Validates target | Announces target | Scoped deletes | Transactional |
| ------------- | ---------------- | ---------------- | -------------- | ------------- |
| `seed.mjs`    | yes              | yes              | by id          | yes           |
| `purge.mjs`   | n/a — see below  | yes              | by id          | yes           |
| `migrate.mjs` | n/a — see below  | yes              | n/a            | per migration |

**Why `migrate` and `purge` do not refuse a remote host.** Both are _supposed_ to run against
production — that is what they are for, and a migration that refuses production is a migration
that never ships. Refusal is the wrong control there; announcement is the right one, and both
now print the host before acting. `purge` additionally prints its whole plan first, dry run or
not, and `--dry-run` takes a code path that cannot delete rather than a flag that skips the
deletes.

`seed` is the one that refuses, because it is the one that must never run against production
under any circumstances: it writes fabricated people.

**Residual.** These controls protect against a mistake, not against an operator who means harm.
Anyone holding the connection string can open `psql` and do worse than any of these tools
allows. That is accepted: the credential is the boundary, and the tools are hardened so that
the ordinary route to disaster — the wrong shell, the wrong afternoon — is closed.

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
