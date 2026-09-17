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

## Implementation notes

- Provisioning must be idempotent and race-safe for the same reason as user creation.
- Storage usage is a sum over a potentially large table — compute it on a cadence into a cached column rather than on every settings page load.
- Quota is a configurable value, never a hard-coded constant (ADR 0001).
- Even with one workspace, resolve the current workspace from the request rather than assuming 'the user's only workspace' — the assumption is exactly what makes multi-workspace painful later.

## Security/privacy considerations

Settings surfaces expose membership, which is sensitive (asset 3 in the threat model). Every settings route runs through `assertCan` with owner-level checks for member management. Quota display must not leak other workspaces' usage.

## Acceptance criteria

- [ ] A workspace and owner membership are created on first sign-in, idempotently.
- [ ] Settings shows name, storage usage, and members.
- [ ] Storage usage is computed from real objects and cached.
- [ ] Quota is read from configuration.
- [ ] Member management routes require owner-level authorization.
- [ ] The current workspace is resolved from the request, not assumed.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Sign in as a brand-new user; confirm a workspace exists immediately.
2. Upload a file and confirm storage usage moves.
3. Sign in as a non-owner and confirm member management is unavailable.

## Rollback/compatibility

Additive. Reverting after workspaces exist would strand memberships.

## Status

`pending`

## Commit

_(not yet)_
