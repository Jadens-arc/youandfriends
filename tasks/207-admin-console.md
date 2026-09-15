# 207 — Administration console

**Phase:** Administration · **Iteration:** **deferred** (post-iteration-one)

## Objective

Build the owner-facing administration surface: audit browsing, member and permission overview, job monitoring, and storage reconciliation reporting.

## User value

Answering 'what happened' and 'who has access to what' without opening a database client.

## Scope

- Audit event browsing with filtering by actor, action, target, and date.
- A permission overview showing effective access per member across the hierarchy.
- Media job monitoring with retry actions.
- Storage reconciliation reporting (`docs/OPERATIONS.md` §5).
- Trash and purge management (task `212`).
- Owner-only access throughout.

## Non-scope

- Multi-workspace administration.
- Billing (task `208`).
- Support impersonation — a significant trust decision requiring explicit consideration.

## Dependencies

`024`, `064`, `025`

## Files expected to change

```
apps/web/app/(workspace)/admin/**
packages/db/src/queries/admin.ts
```

## Implementation notes

- The effective-permission overview is the genuinely valuable part. 'Who can see this song' is hard to answer from grants alone once inheritance and denies are involved, and it is the question owners actually ask.
- Audit browsing must paginate efficiently — the table grows without bound.
- Every route is owner-only, enforced through `assertCan`, and administrative actions are themselves audited.
- Reconciliation reporting is advisory. Deleting objects stays a separate, explicitly confirmed step with a grace period (`docs/OPERATIONS.md` §5).
- Do not build impersonation casually. It is a significant trust decision and deserves its own discussion and its own audit treatment.

## Security/privacy considerations

An administration console aggregates sensitive information and is a high-value target. Owner-only, fully audited (including read access to audit logs), and never exposing credentials or presigned URLs.

## Acceptance criteria

- [ ] Audit events are browsable with efficient pagination and filtering.
- [ ] Effective permissions per member are displayed across the hierarchy.
- [ ] Media jobs are monitorable with retry actions.
- [ ] Storage reconciliation reporting is available and advisory only.
- [ ] Every route is owner-only and every administrative action is audited.
- [ ] No credentials or presigned URLs are exposed.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Browse audit events and confirm filtering works at scale.
2. Check effective permissions for a narrowly scoped collaborator.
3. Attempt access as a non-owner and confirm refusal.

## Rollback/compatibility

Additive. Reverting loses administrative visibility; data is unaffected.

## Status

`pending`

## Commit

_(not yet)_
