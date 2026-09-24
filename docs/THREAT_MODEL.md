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
| Clerk → API (webhook)      | Session events, user profile       |
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

**The current workspace is a claim, not a credential** (task `031`, ADR 0009). A request names
its workspace in the `yaf_workspace` cookie; membership is re-checked on every request, a
workspace the person does not belong to is refused and recorded as `access.denied` in that
workspace's log, and nothing is read from it. Workspace settings and the member list, which
belong to no scope a grant can attach to, are authorized from the membership row alone
(`canInWorkspace`); member management is owner-only.

**Search is bounded before it matches** (task `045`). Search is the most direct route to a leak:
an unfiltered `ILIKE` across songs returns other people's titles, and an unfiltered lyrics match
reveals words. `/api/search` first resolves, from ids and scope chains alone, which projects and
songs this person may open (the library's resolver, grants and denies included); the search
query then runs with those ids in its `WHERE`, so a hidden song is never matched, counted,
ranked, or named — not even as the project around a song shared on its own. The first step
costs the same whatever is typed. Lyrics are matched through the GIN-indexed `tsvector` from
tokens of letters and digits only, so nothing typed reaches the `tsquery` parser as syntax.
Tested with a populated hidden project whose words appear nowhere else.

**The Clerk webhook is public and authenticated by signature** (`/api/webhooks/clerk`). The
Svix signature and timestamp are verified with `CLERK_WEBHOOK_SECRET` before the body is
parsed, so a forged or replayed delivery cannot write an audit row or provision a user. A
payload's user is only used to provision the user its session belongs to. Tests sign
deliveries the way Svix does and run them through the real verifier.

### T2 — Permission escalation through inheritance

A user granted viewer at song level gains editor because a broader folder grant was resolved
incorrectly, or a deny at a child is ignored.

**Controls.** Single resolution path. Most-specific-wins with explicit-deny override, tested
as an enumerated matrix across role × capability × scope depth. Permission changes take effect
on the next request and are propagated into active Liveblocks rooms (task `082`).

**A delegated `can_invite` is not delegated authority to mint access beyond its holder's own**
(task `032`). `can_invite` is independent of role — a commenter can hold it — so without a cap,
that commenter could invite someone as an editor anywhere in the workspace, which is escalation
by way of the invitation itself rather than a resolution bug. `canGrantAccess`
(`packages/authz/src/invitations.ts`) caps the offered role and each offered capability by what
the inviter's own resolved `EffectiveAccess` holds at the exact target, checked at send time; a
role is capped by `roleAtLeast`, and `canDownload`/`canInvite` are capped independently, matching
how they resolve. `owner` cannot be offered by any invitation, enforced twice — the contracts
layer's `INVITABLE_ROLES` and a database CHECK constraint — because it is workspace-wide
administration, never a scope grant (ADR 0010).

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
authz check on the song the room names (`lyrics:<songId>`), for that one room only: `room:write`
for an editor, `room:read` plus their own presence for a commenter or viewer, and a 404-shaped
refusal for anyone else, a room in another workspace, a trashed song, or anything that is not a
lyrics room (task `082`). The client never states its own role.

Demotion is enforced in layers, because Liveblocks cannot recall a token it has already issued:

- **Postgres rejects it at once.** Every save re-checks `edit`; the demoted person's next save is
  refused 404-shaped and nothing of theirs is stored after that point.
- **The editor stops at once.** An open editor re-asks for its access every 30 seconds and on
  return to the tab, and after any refused save; on a change it stops accepting input and
  rejoins the room, which mints a new token at the new access.
- **The record is derived, not trusted.** A collaborative save sends Yjs state, which the server
  merges into what is stored and re-derives the document from through the lyrics schema, so
  anything outside that schema is dropped rather than stored.

The residual gap is written down under "Residual risks accepted".

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

**A workspace reaching zero owners is destructive by the same standard — nothing in the product
can recover it, because every recovery action needs an owner** (task `032`). `changeMemberRole`
and `removeMember` (`apps/web/lib/workspace/members.ts`) refuse a write that would leave zero.
The guard's own count is a plain unlocked read, and being right inside the same transaction as
the write it gates does not by itself make it safe against a _second_ transaction acting on a
_different_ owner's row at the same moment — two owners demoted or removed concurrently can each
see the other still as `owner`, under Postgres's default READ COMMITTED isolation, and both
proceed (write skew; found in security review, reproduced in a looped concurrent test). Closed
by `lockWorkspaceForMembershipWrite` (`packages/db/src/queries/workspace.ts`), a `SELECT ... FOR
UPDATE` on the workspace row taken first in both functions, serializing every membership write
for one workspace against every other. See ADR 0010.

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

### T11 — Invitation abuse

Guessing or brute-forcing an invitation token, learning whether an address was ever invited by
the shape of a failure, or accepting an invitation as someone other than the person it was sent
to (task `032`).

**Controls.** Tokens are `yaf_invite_<ulid>_<secret>` — the ULID is a public lookup key, the
secret is 256 bits of `crypto.randomBytes`, base64url-encoded, and only its `scrypt` hash is
stored (ADR 0010 records the deliberate departure from ADR 0005's Argon2id). The secret is
compared in constant time. **Every failure looks the same to the caller**: a wrong secret, an
expired invitation, a revoked one, and a token that never existed all produce one generic
message (`apps/web/lib/invitations/accept.ts`) — whether the difference matters is exactly what
an attacker probing tokens would use it to learn. The secret is checked _before_ state or
expiry, so a failed verification tells nothing about whether the invitation is otherwise live.

**An invitation binds to the email it was sent to.** Acceptance compares the invitation's stored
address against the signed-in Clerk identity's own email, both lowercased and trimmed the same
way. A mismatch is the one case that _does_ get a specific message — naming the invited address
to someone who has already proven they hold the token (by presenting a valid, unexpired,
unrevoked secret) tells them nothing they could not see by comparing their own inbox to their
own session; it is not the enumeration risk the generic-failure rule above exists to close.
There is no rebind flow in iteration one: a mismatched invitation simply cannot be accepted.

**Acceptance is atomic.** Marking the invitation accepted, creating the scope-limited membership
row, and writing the permission grant all happen in one transaction
(`withAuditedTransaction`); a failure partway rolls all of it back rather than leaving a member
with no access or a grant with no member, per the task's own acceptance criteria.

**A scope-limited collaborator's membership carries no workspace-wide baseline** — `role: null`
on `workspace_memberships`, treated by `loadMembership` exactly as "no membership at all" (ADR
0010). Without this, accepting an invitation to one song would grant viewer-or-better access to
every other song in the workspace through the resolver's ordinary membership-baseline rule,
which is the permission-escalation shape T2 exists to prevent, reached through the invitation
path rather than a resolution bug. Proven end to end against a real database in
`packages/authz/src/__tests__/scope-limited-membership.test.ts`, not only in the pure resolver
matrix.

### T12 — Media processing of untrusted files

Tasks `060`–`066`, `068`. The media worker (`apps/jobs`) runs **ffmpeg and ffprobe — two large C
programs — against bytes anyone with upload access chose**, in a process that holds database and
storage credentials and briefly has a decoded copy of someone's unreleased master on disk.

**Assets.** Every workspace's originals and derivatives (the worker can read one and write the
other), the worker's credentials, and the decoded audio in its scratch space.

**Boundary.** The uploaded bytes are untrusted until the pipeline has finished with them; the job
payload is untrusted too (a queue message can outlive a deploy, or be written by whoever can write
to the queue). The worker trusts only the database rows it reads for itself.

| Threat                                                                                                              | Control                                                                                                                                                                                                                                                                                                                                                                                                                            | Enforced in                                                                                                                 | Tested in                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Decoder or demuxer exploitation** — a malformed container is the classic memory-safety target                     | A **minimum ffmpeg version** (6.1), asserted with the encoders and filters at every job's start — a build with known-fixed demuxer bugs refuses to work; the process is a short-lived child with no shell; container memory and disk limits are deployment-owned (`docs/OPERATIONS.md` §3). Sandboxing the decoder per job is not done in iteration one (see residual risks).                                                      | `packages/media/src/capabilities.ts` (`MINIMUM_FFMPEG_VERSION`, `assertCapabilities`)                                       | `packages/media/src/__tests__/capabilities.test.ts` (a stand-in ffmpeg reporting 4.4, 6.0, or a git snapshot is refused) |
| **External-reference demuxers** — HLS playlists, concat lists, QuickTime data references naming other files or URLs | Every ffmpeg and ffprobe invocation passes **`-protocol_whitelist file`** before `-i`, so no input can make the decoder open a network URL, whatever the build's defaults; input paths must be **absolute**, so a name cannot be read as an option or a protocol                                                                                                                                                                   | `untrustedInput()` in `packages/media/src/run.ts`, used by probe, loudness, derivative and waveform                         | `packages/media/src/__tests__/run.test.ts`                                                                               |
| **Command injection**                                                                                               | Tools are run from an **argument vector, never a shell string** (`execFile`/`spawn` with `shell: false`); nothing a user named — filenames included — reaches an argument except as an opaque scratch path                                                                                                                                                                                                                         | `packages/media/src/run.ts`                                                                                                 | `run.test.ts`                                                                                                            |
| **Resource exhaustion** — a file that decodes forever, a huge output, a decompression bomb                          | A **whole-job deadline** (55 min) feeding every tool's timeout; **bounded parent buffers** (`maxOutputBytes`); a **scratch-space budget** checked between stages; a size ceiling checked before download and during it (the download stops at the recorded size); duration over six hours rejected. The child's own memory is bounded by the container limit, which is deployment-owned. ZIPs are never expanded server-side (T4). | `apps/jobs/src/pipeline.ts`, `packages/media/src/run.ts`, `workspace.ts`, `validate.ts`, `packages/storage/src/transfer.ts` | `apps/jobs/src/__tests__/pipeline.test.ts` (timeout), `workspace.test.ts`, `transfer.test.ts`                            |
| **Orphaned children** — a job outliving its timeout                                                                 | **`SIGKILL` on timeout**, not `SIGTERM`, so a child that ignores signals still dies; the queue's own `maxDuration` sits above the job deadline                                                                                                                                                                                                                                                                                     | `packages/media/src/run.ts`; `apps/jobs/src/trigger/process-audio.ts`                                                       | `run.test.ts` ("kills a child that ignores SIGTERM")                                                                     |
| **Scratch-space disclosure** — a co-tenant reading the decoded copy of a master                                     | Scratch directories come from `mkdtemp`, **mode 0700**, with a validated prefix, and are removed on every exit path including failure                                                                                                                                                                                                                                                                                              | `packages/media/src/workspace.ts`, `withTempWorkspace` in the pipeline                                                      | `workspace.test.ts` (0700), `pipeline.test.ts` (cleanup after success, rejection and failure)                            |
| **A payload naming someone else's object**                                                                          | The worker reads the object key **from the version's own row** and refuses a payload whose key differs; derivatives are written only to keys derived from their own row, and the transfer refuses to write any original's key                                                                                                                                                                                                      | `apps/jobs/src/pipeline.ts` (`beginAttempt`), `packages/storage/src/transfer.ts`                                            | `pipeline.test.ts`, `transfer.test.ts`                                                                                   |
| **Tool output reaching a person** — paths, codec internals, stderr                                                  | People see a sentence from `PROCESSING_FAILURE_MESSAGES`; tool output stays in `media_jobs.last_error`, sanitized of scratch paths and URLs                                                                                                                                                                                                                                                                                        | `apps/jobs/src/pipeline.ts`, `packages/contracts/src/assets.ts`                                                             | `pipeline.test.ts`                                                                                                       |

## Explicit non-goals for iteration one

Stated plainly so they are not mistaken for oversights:

- **No end-to-end encryption.** The server can read stored media. E2EE is incompatible with
  server-side transcoding and waveform generation.
- **No protection against a malicious workspace owner.** Owners are trusted by design.
- **No DRM.** An authorized listener can record what they can hear.
- **No advanced availability engineering.** Provider outages degrade the product.

## Residual risks accepted

- Provider compromise (Clerk, Neon, R2, Liveblocks, Trigger.dev) exposes data.
- **The decoder is not sandboxed per job** (T12). A working ffmpeg exploit runs with the worker's
  credentials, which can read every workspace's originals. The version floor, short-lived
  processes, and container limits narrow this; a seccomp profile or a container per job would
  close more of it and is a deployment change deliberately left out of iteration one.
- **A demoted collaborator's already-issued room token keeps working until it expires**
  (T6, task `082`). Liveblocks offers no per-user revocation of an access token, and its lifetime
  is set by Liveblocks, not by us. An honest client stops within seconds (above); a _modified_
  client could keep sending edits into the room for the rest of that token's life, and an
  editor's autosave or the webhook would then merge them into Postgres. Everything merged stays
  in the Yjs history and in revisions (task `084`), so it can be seen and reverted, not hidden.
  Closing this fully means either moving to ID tokens with room-level permissions that
  Liveblocks re-checks, or relaying updates through our own server; both are larger than
  iteration one and are a decision for the product owner.
- A compromised owner account exposes the workspace.
- Presigned URLs are bearer credentials for their TTL; a URL shared within its window works.
- **No rate limiting on invitation-token acceptance attempts** (task `032`). The task file's own
  security notes ask for it; this codebase has no rate-limiting infrastructure yet to hook into
  — share links (T5), the first feature that would need it, are deferred to task `200`+. The
  gap is accepted rather than built ad hoc here because an invitation secret is 256 bits of
  `crypto.randomBytes`, not a short human-chosen value like a share-link password: brute-forcing
  that space is computationally infeasible regardless of request rate, so the controls that
  actually close this threat are the ones T11 describes — high entropy, a constant-time
  comparison, and a generic failure message that does not distinguish "wrong" from "expired"
  from "never existed" — not throttling. Rate limiting remains worth adding as defense in depth
  once the infrastructure exists for T5; until then this is a documented gap, not a silent one.
