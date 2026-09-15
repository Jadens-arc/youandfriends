# 216 — Postgres row-level security as defense in depth

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add row-level security policies as a second enforcement layer beneath `packages/authz`, per ADR 0006's deferred consideration.

## User value

A second lock on tenant isolation, so an application bug alone cannot leak across workspaces.

## Scope

- RLS policies enforcing workspace scoping on every tenant-owned table.
- Per-request session variable carrying the workspace context.
- Verification that policies hold under Neon's connection pooling.
- Tests confirming RLS blocks access that application code would otherwise allow.
- Performance measurement before and after.

## Non-scope

- Replacing `packages/authz` — RLS is a second layer, not a substitute.
- Expressing the full most-specific-wins grant model in RLS, which ADR 0006 found awkward.
- RLS on non-tenant tables.

## Dependencies

`023`

## Files expected to change

```
packages/db/migrations/**
packages/db/src/client.ts
packages/db/src/__tests__/rls.test.ts
```

## Implementation notes

- ADR 0006 deferred this for two specific reasons: the grant model is awkward to express in policies, and Neon's pooled connections complicate per-request session variables. Address both explicitly before building, and update the ADR with what you find.
- Scope RLS to **workspace isolation only** — the coarse, high-value boundary. Leave the fine-grained grant resolution in `authz` where it is testable.
- Verify session variables survive connection pooling. If a pooled connection retains a previous request's workspace context, RLS becomes actively dangerous rather than protective.
- Write the test that proves RLS blocks a deliberately broken query. An RLS layer nobody has verified is decoration.
- Measure performance. Policies evaluated per row can be costly on large tables.

## Security/privacy considerations

This directly hardens THREAT_MODEL T1. With RLS in place, an application bug that forgets workspace scoping is caught by the database rather than leaking data. That is exactly the failure mode most likely to occur and most damaging when it does.

## Acceptance criteria

- [ ] RLS policies enforce workspace scoping on every tenant-owned table.
- [ ] Session variables carry workspace context correctly under Neon pooling, verified.
- [ ] A test confirms RLS blocks a deliberately unscoped query.
- [ ] Performance impact is measured and recorded.
- [ ] `packages/authz` remains the primary layer.
- [ ] ADR 0006 is updated with the findings.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Write a query that deliberately omits workspace scoping; confirm RLS blocks it.
2. Verify session context does not leak across pooled connections.
3. Compare query performance before and after.

## Rollback/compatibility

Additive policies. Reverting removes the second layer; `authz` continues to enforce. Test thoroughly before deploying — a misconfigured policy can block legitimate access.

## Status

`pending`

## Commit

_(not yet)_
