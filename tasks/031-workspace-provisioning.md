# 031 — Workspace provisioning and settings

**Phase:** Authentication and workspace · **Iteration:** one

## Objective

Create a private workspace for a new owner on first sign-in, with settings for name, storage quota display, and member management entry points.

## User value

The owner's private space exists from the first moment, already theirs, with nothing to configure before starting work.

## Scope

- Workspace creation on first sign-in, with the owner's membership.
- A settings surface: workspace name, storage usage against `YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`, member list.
- Storage usage computed from `storage_objects`, cached and refreshed on a sensible cadence.
- Workspace switching scaffolding for the single-workspace case, so multi-workspace is additive later.
- **Audit events for sign-in, sign-out, and failed access**, moved here from task `030`.
  `audit_events.workspace_id` is `NOT NULL`, so these could not be written before a workspace
  existed — and this task is what creates one. Correct `emittedBy` for `auth.signed_in`,
  `auth.signed_out`, `auth.session_revoked`, and `access.denied` in
  `packages/contracts/src/audit.ts`, which still says `030`.

**How the audit moved here landed** (ADR 0009). Sign-in, sign-out, and revocation come from
Clerk's session webhooks — the server is never told about a sign-out any other way — at
`/api/webhooks/clerk`, verified by Svix signature before anything is parsed. Each event is written
into every workspace the person belongs to. Failed access is recorded for workspace settings,
member management, rename, and a workspace selection naming somewhere the person does not belong.
`access.denied` needed no `emittedBy` correction: it already read `024`, whose `auditDecisions`
sink emits it; the `030` note that it said `030` was out of date. The three `auth.*` actions now
read `031`, and `workspace.created` is new (migration `0007`).

## Non-scope

- Billing (deferred `208`).
- Multi-workspace membership UI.
- An administration console (deferred `207`).

## Dependencies

`030`, `021`

## Files expected to change

```
apps/web/app/(workspace)/settings/**
apps/web/lib/workspace/**
packages/db/src/queries/workspace.ts
apps/web/app/(workspace)/settings/__tests__/**
```

What actually changed, beyond that list, and why:

```
packages/db/src/schema/workspaces.ts, migrations/0007_*   provisioning key, cached usage columns
packages/contracts/src/{audit,actions}.ts                  emitters corrected; workspace actions
packages/authz/src/workspace.ts                            membership-only workspace decisions
apps/web/app/api/webhooks/clerk/route.ts                   session audit (moved here from 030)
apps/web/lib/auth/{identity,session-events,session}.ts     one identity derivation for both paths
apps/web/lib/database.ts                                   request-time transactional handle
apps/web/lib/uploads/service.ts                            finalize invalidates cached usage
apps/web/components/{settings,workspace}/**                settings view, workspace gate
apps/web/components/shell/**                               settings in the rail and mobile header
docs/adr/0009-*, THREAT_MODEL.md, OPERATIONS.md, .env.example
tasks/032-*                                                two ordering notes this task creates
```

## Implementation notes

- Provisioning must be idempotent and race-safe for the same reason as user creation.
- Storage usage is a sum over a potentially large table — compute it on a cadence into a cached column rather than on every settings page load.
- Quota is a configurable value, never a hard-coded constant (ADR 0001).
- Even with one workspace, resolve the current workspace from the request rather than assuming 'the user's only workspace' — the assumption is exactly what makes multi-workspace painful later.

## Security/privacy considerations

Settings surfaces expose membership, which is sensitive (asset 3 in the threat model). Every settings route runs through `assertCan` with owner-level checks for member management. Quota display must not leak other workspaces' usage.

## What review found

Security review found nothing critical or high. Two medium, three low, all addressed:

- **A stale or hostile workspace cookie wrote an audit row into another tenant's log on every
  request.** Now at most once per person per workspace per hour, under an advisory lock; tested,
  and removing either the check or its actor filter fails by name.
- **Every viewer saw every member's email.** Addresses now go only to someone who may manage
  members (ADR 0009); tested at the use case and in the view.
- **ADR 0009 said a person removed from every workspace is re-provisioned.** Not true for someone
  removed from the workspace made for them, whose key still holds; they fail closed. The ADR now
  says so and a test pins it.
- **Workspace names allowed bidirectional overrides and zero-width characters.** Refused now,
  except the zero-width joiner that emoji sequences need, and a name needs a visible character.
- **Rename authorizes before its transaction opens.** Accepted and recorded in ADR 0009: the
  window is milliseconds, the rename is audited, and closing it means changing every audited
  write, not this one.

Test review confirmed the evidence for every criterion and found one surviving mutation: deleting
`renameWorkspace`'s `FOR UPDATE` passed every test. A lock-orchestrated race test now catches it.
Its one other note, that no test forces a `created_at` tie to exercise the `id` tiebreak in
member ordering, is left as it is: the tiebreak only fixes the order of rows written in one
transaction, and nothing here writes two memberships in one.

Release-check also caught a defect outside this task's files: `packages/db/src/migrate.ts`
computed its folder from `import.meta.dirname` at module load. A bundle has no `dirname`, so the
first route to import `@youandfriends/db` (the Clerk webhook) failed the production build. It now
falls back to `import.meta.url` where `dirname` is absent.

## Acceptance criteria

- [x] A workspace and owner membership are created on first sign-in, idempotently.
      `provisionWorkspace` inserts against a unique `provisioned_for_user_id`, so a race resolves
      to one row by constraint. `packages/db/src/__tests__/workspace.test.ts` proves it with two
      transactions held open until the second is observed blocked on the index; removing
      `ON CONFLICT` fails that test. The layout's `WorkspaceGate` resolves on every workspace
      render, so the first authenticated page is the moment it exists. Invited collaborators are
      not given one (tested; the membership check's removal fails two tests).
- [x] Settings shows name, storage usage, and members.
      `/settings`, reached from the rail and, on the phone, the header. Usage is text plus a
      labelled `meter`; roles are words. `components/settings/__tests__`.
- [x] Storage usage is computed from real objects and cached.
      Summed from `storage_objects` into `workspaces.storage_used_bytes`, trusted for ten minutes,
      invalidated in the finalize transaction. Tests put 7 GB in a foreign workspace next to 5 MB
      here; dropping the tenant filter, the cache, or the invalidation each fails by name.
- [x] Quota is read from configuration.
      `YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`, parsed per render and passed in; the page test stubs
      the variable and asserts the value reaches the use case.
- [x] Member management routes require owner-level authorization.
      `/settings/members` → `readMemberManagement` → `canInWorkspace(…, 'manage_members')`,
      owner-only in `WORKSPACE_ACTION_REQUIREMENTS`. Editor, viewer, and the owner of a different
      workspace are refused 404-shaped and each refusal is audited; weakening the requirement to
      `editor` fails `refuses editor manage_members`.
- [x] The current workspace is resolved from the request, not assumed.
      `resolveWorkspace` honours the `yaf_workspace` cookie only for a workspace the person
      belongs to. The test that fails "the user's only workspace" has two memberships and a
      request naming the second.
- [x] Sign-in, sign-out, session revocation, and failed access are audited (moved from `030`).
      `lib/auth/__tests__/session-events.test.ts` and `clerk-webhook-route.test.ts` — the latter
      signs deliveries exactly as Svix does and runs them through Clerk's real `verifyWebhook`;
      forged, altered, replayed, and unsigned deliveries are refused with nothing written. Live
      delivery needs the endpoint configured in Clerk and `CLERK_WEBHOOK_SECRET` set (below).

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

Not yet performed; each needs the production deploy described in `docs/OPERATIONS.md` §1
(migration `0007`, `DATABASE_URL_UNPOOLED` in Vercel, the Clerk webhook and its secret).

1. Sign in as a brand-new user; confirm a workspace exists immediately.
2. Upload a file and confirm storage usage moves. **Not possible yet:** there is no upload
   endpoint until task `058`. Covered meanwhile by the finalize test that asserts invalidation.
3. Sign in as a non-owner and confirm member management is unavailable. **Needs a second member**,
   which needs invitations (task `032`). Covered meanwhile by the settings tests.
4. Sign in and out; confirm Clerk's webhook log shows `200` for both and the rows exist.

## Rollback/compatibility

Additive. Reverting after workspaces exist would strand memberships.

## Status

`complete`

## Commit

`1ee0672bacdd34e7ce96a8f58fc5d57375d45b8f`
