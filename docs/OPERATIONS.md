# You & Friends — Operations Guide

_A private music workspace by Avery and Friends._

Runbooks for keeping the workspace healthy. Every procedure here is intended to be safe to
run against production without a maintenance window unless stated otherwise.

## 1. Deployment

### Prerequisites

| Service       | What you create                               | Where the value goes    |
| ------------- | --------------------------------------------- | ----------------------- |
| Neon          | Postgres project, `main` + `preview` branches | `DATABASE_URL`          |
| Clerk         | Application, sign-in configured               | `CLERK_*` keys          |
| Cloudflare R2 | Two private buckets: originals, derivatives   | `R2_*`                  |
| Liveblocks    | Project                                       | `LIVEBLOCKS_SECRET_KEY` |
| Trigger.dev   | Project                                       | `TRIGGER_*`             |
| Vercel        | Project linked to the repo                    | all of the above        |

### Order of operations

1. `pnpm install`
2. `pnpm --filter @youandfriends/db migrate` against Neon — **run migrations before deploying
   code that depends on them.**
3. `pnpm --filter @youandfriends/jobs deploy` — jobs must exist before the web app enqueues.
4. Deploy `apps/web` to Vercel.
5. Verify with the smoke checklist (§7).

Rolling back code is safe. Rolling back a migration is not automatic — see §4.

## 2. Stuck uploads

**Symptom:** an upload shows progress but never finalizes, or `upload_sessions` rows sit in
`pending` past their expiry.

**Diagnose.**

```sql
SELECT id, state, created_at, expires_at, expected_bytes, object_key
FROM upload_sessions
WHERE state <> 'completed' AND created_at < now() - interval '2 hours'
ORDER BY created_at;
```

**Resolve.** A session past expiry with no parts is abandoned — abort the multipart upload in
R2 and mark the row `expired`. A session with all parts present but no finalize is a client
that died between the last part and the complete call; the finalize endpoint is idempotent, so
re-issuing the complete call for that session is safe and is the correct fix.

```bash
pnpm --filter @youandfriends/db ops:uploads:sweep --dry-run
pnpm --filter @youandfriends/db ops:uploads:sweep
```

The sweep aborts expired R2 multipart uploads (reclaiming storage — **incomplete multipart
parts are billed**), marks sessions expired, and never touches a session younger than its
expiry.

## 3. Stuck or failed media jobs

**Symptom:** a version shows "processing" indefinitely, or no waveform appears.

**Diagnose.** Check the Trigger.dev run dashboard first, then:

```sql
SELECT id, asset_version_id, state, attempts, last_error, updated_at
FROM media_jobs
WHERE state IN ('queued','running','failed')
  AND updated_at < now() - interval '30 minutes';
```

**Resolve.** The pipeline is idempotent and keyed on `asset_version_id`, so re-enqueueing is
always safe — it will not create duplicate derivatives.

```bash
pnpm --filter @youandfriends/jobs ops:media:retry --version <assetVersionId>
pnpm --filter @youandfriends/jobs ops:media:retry --all-failed
```

If a job fails repeatedly on one file, the original is likely not valid media. Confirm with
`ffprobe` against a downloaded copy. A non-media file uploaded as audio should be reclassified
rather than retried — the original is preserved regardless, and reclassification never touches
stored bytes.

**Derivatives are disposable.** If derivatives are ever corrupt or a recipe changes, deleting
the `derivatives` rows and re-enqueueing regenerates them from untouched originals.

## 4. Migrations

**Forward.** Drizzle migrations are generated, reviewed by a human, and applied in order.

```bash
pnpm --filter @youandfriends/db generate     # after a schema edit
pnpm --filter @youandfriends/db migrate:dry  # against an isolated branch
pnpm --filter @youandfriends/db migrate
```

**Always dry-run first.** `migrate:dry` creates a throwaway database on the configured
server, applies every migration to it, and drops it — passing or failing. It runs as a
`release-check` gate, so a migration Postgres rejects fails the build rather than the deploy.
Exit codes: `0` passed, `0` skipped (announced in the output), `1` failed.

### Where the commands get their connection string

All three read `DATABASE_URL_UNPOOLED`, never `DATABASE_URL`. Neon's serverless HTTP driver
cannot hold an interactive transaction, and a migration is a transaction — pointing these at
the pooled URL produces schema changes that appear to apply and do not.

The value is taken from the ambient environment first (CI sets the real one), then from
`.env.test.local`, then `.env.local`. Both files are `.gitignore`d and must stay that way: a
connection string is a credential, and one in the repository is compromised from the moment
it is committed. The test harness uses the same loader, so the tests and the migrator can
never disagree about which database they are pointed at.

With nothing configured, `migrate:dry` **skips and says so**. A silent pass would be a lie in
the build output.

### Verifying against Neon from a restricted network

Some environments — including Claude Code's remote sandbox — allow outbound HTTPS only
through a proxy allow-list, which blocks both Postgres on 5432 and Neon's HTTPS endpoint. The
symptom is a command that hangs rather than fails; `CONNECT_TIMEOUT_MS` in
`packages/db/src/client.ts` bounds it at ten seconds so a release gate cannot hang forever.

From such an environment, run the suite against a local Postgres and verify Neon itself
through the Neon API or console. That is what happened for task `020`: every test and the
dry-run gate ran against a real Postgres 16, and the Neon project was confirmed live and
empty through the API.

**Backward.** Destructive migrations (dropping a column, narrowing a type) follow expand →
migrate → contract across three deploys, never one:

1. **Expand** — add the new structure, write to both, read from the old.
2. **Migrate** — backfill, switch reads to the new.
3. **Contract** — stop writing the old, then drop it in a later deploy.

A single-deploy destructive migration is a stop condition for `/loop`, not a judgment call
for an agent to make alone.

## 4b. Reading the audit log

Every authentication, access, sharing, permission change, upload, edit, download, deletion,
restoration, and administrative action is recorded in `audit_events`, in the same transaction
as the change it records. A rolled-back action leaves no event.

**Reading it.** `queryAuditEvents` in `@youandfriends/authz` — workspace owners only. The
administration UI is deferred to task `207`; until then an investigation runs it directly.

```ts
await queryAuditEvents(db, ownerSubject, workspaceId, {
  targetId: songId, // or actorId, action, targetType
  limit: 100, // capped at MAX_AUDIT_PAGE
});
```

Rows are returned newest first **by id, not timestamp**: several events written in one
transaction share a timestamp to the millisecond, and ids are monotonic within one, so the
order they are read is the order they happened.

**Joining to the logs.** Each row carries `correlation_id`. Search the structured logs for the
same value to get the request that produced it.

**The log cannot be edited.** `UPDATE`, `DELETE`, and `TRUNCATE` are refused by a database
trigger, for every caller including the role the application connects as. If history looks
wrong, the remedy is a corrective event, never a correction.

**Deleting a workspace is refused while its events exist.** That is deliberate: a cascade
would destroy the record as a side effect of another action. Purging a tenant's history is a
separate, deliberate retention procedure, and `docs/DESIGN.md` §13 lists retention and
account-closure behaviour as work to complete before public launch.

**Metadata is redacted on the way in.** Secrets, presigned URLs, and password verifiers never
reach the column — redacting on the way out would leave them sitting in the one table designed
never to be edited.

## 4c. Trash, restore, and purge

Deleting is not destroying. Every user-visible entity carries `deleted_at`, `deleted_by`,
`purge_after`, and `deleted_batch`; the row stays until a purge run destroys it after the
recovery window (`YOUANDFRIENDS_RECOVERY_WINDOW_DAYS`, default 30).

**Restore is by batch, not by entity.** Deleting a folder marks its subtree, the projects
filed in it, and the songs in those — all with one `deleted_batch`. Restoring that batch
brings back exactly those rows. A song its owner trashed separately, a week earlier, keeps
its own batch and stays in the trash where they put it. Re-deriving the cascade at restore
time would resurrect it.

Two repairs happen on the way back:

- A project whose folder is still deleted returns **unfiled**, which is a place the user can
  find it rather than a pointer at something invisible.
- A song whose project is still deleted **blocks** the restore with `RestoreBlockedError`.
  `project_id` is not null and there is nowhere honest to put it; restoring the project
  silently would be a bigger action than the one asked for.

### The purge job

```bash
pnpm --filter @youandfriends/db purge -- --dry-run            # plan only, destroys nothing
pnpm --filter @youandfriends/db purge -- --workspace <ID>     # confine to one tenant
pnpm --filter @youandfriends/db purge -- --limit 100          # cap the blast radius
pnpm --filter @youandfriends/db purge                         # execute
```

**This is the only command in the repository that destroys user work.** Read the plan before
running it without `--dry-run`. The plan is printed every time, run or not, so the job output
afterwards shows exactly what was intended.

`--dry-run` is not a flag that skips the deletes. It takes a code path that never opens a
write transaction, so a mistake in flag handling cannot destroy anything.

**What the job refuses to do.** A parent is destroyed only when every descendant goes with it
in the same run, and a refusal travels upward: a project held back keeps its folder alive too.
Two silent-data-loss paths make that necessary, both found by running the job against real
rows rather than by reading it:

- `songs.project_id` cascades on delete, so purging a project hard-deletes every song still
  pointing at it — including one trashed yesterday and still recoverable.
- `projects.folder_id` is `on delete set null`, so purging a folder silently unfiles the
  project inside it.

Refusals are printed with their reason:

```
  Held back:
    KEEP    projects NKNYDM…  — song QPZP49… is in the trash and not yet purgeable
    KEEP    folders  MJ99Y6…  — project NKNYDM… is in the trash and not yet purgeable
```

**The plan is a proposal, never a warrant.** Execution re-checks each row, so anything an
owner restored between planning and running is skipped.

**Storage is not wired yet.** `packages/storage` arrives in task `050`. Until then a plan
naming storage objects makes the run refuse rather than delete rows and orphan the objects
they pointed at — an orphan no later run can find, because the pointers are gone. When it is
wired, objects are deleted **after** the rows within the same transaction: if it rolls back
afterwards the objects are gone but the rows still say what was lost, which is recoverable;
the other order destroys the record of what to look for.

**Every delete, restore, and purge is audited** per row, not per operation. Deleting a folder
can remove forty songs, and "who deleted this song" has to be answerable for each of them.
For a purged row the audit event is the only remaining record that it ever existed.

## 5. Orphan cleanup and storage reconciliation

Three classes of drift, each with an opposite risk:

| Drift                        | Risk                     | Remedy                              |
| ---------------------------- | ------------------------ | ----------------------------------- |
| R2 object with no DB row     | Paying for nothing       | Safe to delete after a grace period |
| DB row with no R2 object     | Broken playback/download | **Never auto-delete.** Investigate. |
| Incomplete multipart uploads | Billed storage           | Abort after expiry (§2)             |

```bash
pnpm --filter @youandfriends/db ops:storage:reconcile --dry-run
```

The reconcile report is **advisory**. Deleting objects is a separate, explicitly confirmed
step with a grace period no shorter than 7 days, because an object that appears orphaned may
belong to an upload session that is mid-flight. Run reconcile monthly.

## 6. Backup and restore

**Database.** Neon's point-in-time restore is the primary mechanism; confirm the retention
window on the current plan. Take an explicit logical dump before any destructive migration:

```bash
pg_dump "$DATABASE_URL" -Fc -f "youandfriends-$(date +%Y%m%d).dump"
```

**Object storage.** R2 holds the only copy of user music. Enable versioning and configure a
lifecycle rule retaining noncurrent versions for the soft-delete recovery window.

**Restore drill.** Restoring the database without restoring storage produces rows pointing at
absent objects. Test the restore path against a Neon branch at least once before relying on
it. An untested backup is a hypothesis.

## 7. Smoke checklist after deploy

1. Sign in with Clerk.
2. Library loads; folders, projects, and songs render.
3. Upload a small audio file; progress advances and finalize completes.
4. Media job completes; waveform renders; playback starts.
5. Player survives a route change.
6. Lyrics editor loads, autosaves, and shows presence in a second browser.
7. Post a timestamped comment.
8. iPhone viewport renders the same flows.

## 8. Key rotation

Rotate on a schedule and immediately on any suspicion of exposure.

**R2 credentials.** Create a new key pair, deploy it, verify uploads and downloads, then
revoke the old pair. R2 keys are used only server-side for signing, so rotation does not
invalidate presigned URLs already issued — those expire on their own short TTL.

**Clerk keys.** Rotate in the Clerk dashboard and redeploy. Active sessions survive; rotating
the secret key does not sign users out.

**`DATABASE_URL`.** Rotate the Neon role password, update Vercel and Trigger.dev, redeploy
both. Update both — a stale job deployment fails silently against the old credential.

**Sync tokens.** User-facing. Revoke from settings; the agent shows a disconnected state and
the user pairs again.

**After any rotation**, confirm `apps/jobs` still authenticates. It is the deployment most
easily forgotten because nothing user-visible breaks until the next upload.

## 9. Known iOS and PWA limitations

Documented honestly rather than worked around dishonestly:

- **Web Push** requires the PWA to be added to the Home Screen on iOS, and delivery is less
  dependable than native. In-app notifications are the required path; push is deferred
  (task `210`).
- **Background audio** works through native `<audio>` and Media Session, but a fully custom
  Web Audio graph can be suspended when backgrounded. This is why playback uses native audio
  elements (ADR 0004).
- **Storage eviction.** Safari may evict Cache Storage under pressure. Offline downloads must
  therefore always show real state and re-download gracefully — never assume a cached file is
  still present.
- **No true gapless playback** is guaranteed on Safari. We preload the next queue item for
  best-effort continuity and do not claim gapless where the browser cannot deliver it.
- **AirPlay** is exposed through native media controls only. We do not present a custom
  AirPlay picker, because the web platform does not offer reliable control of one.

## 10. Cost monitoring

Review monthly against ADR 0001's assumptions:

- R2 stored bytes and Class A/B operation counts.
- Neon compute hours and storage.
- Trigger.dev run count and duration.
- Liveblocks MAU and connections.

`YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES` caps growth. Storage usage is surfaced in the UI as a
library module, so the user sees drift before a bill does.
