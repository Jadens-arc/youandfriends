# 022 — Centralized authorization package

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Implement `packages/authz` as the single source of permission truth: grant storage, scope-chain resolution, most-specific-wins with deny override, independent capabilities, and a lint rule making the boundary mechanical.

## User value

Owners can grant a collaborator access to exactly one song, or a whole folder, and be confident the rule holds everywhere.

## Scope

- `permission_grants` table: scope type (folder/project/song), scope id, subject, role, `can_download`, `can_invite`, `is_deny`, active window.
- `resolveAccess(subject, target)` walking the scope chain song → project → folder → ancestors → workspace.
- Most-specific-wins resolution; explicit deny at any level beats an inherited allow from a less specific level.
- `assertCan(subject, action, target)` throwing a typed `Forbidden` that serializes 404-shaped.
- `scopedQuery(subject, workspaceId)` returning a pre-filtered database handle.
- Subject types: workspace member, sync token (task `110`), share-link bearer (deferred `200`) — the union is defined now so later subjects do not require reworking resolution.
- An ESLint rule forbidding `@youandfriends/db` imports in route handlers without `@youandfriends/authz`.

## Non-scope

- The exhaustive test matrix (task `023`) — this task ships the mechanism and a smoke test.
- Audit event emission (task `024`), though the hook points are defined here.
- Invitation flows (task `032`).

## Dependencies

`021`, `003`

## Files expected to change

```
packages/authz/src/{resolve,chain,target,authorizer,scoped-query,subjects,index}.ts
packages/authz/src/{resolve,__tests__/smoke}.test.ts
packages/db/src/schema/permissions.ts
packages/db/migrations/0001_permission_grants.sql
packages/db/src/__tests__/index.ts
packages/config/src/eslint/rules/{no-unscoped-db,index}.mjs
packages/config/src/eslint/rules/no-unscoped-db.test.ts
packages/config/src/eslint/boundaries.mjs
packages/contracts/src/actions.ts
apps/web/eslint.config.mjs
```

`assert.ts` folded into `authorizer.ts`: `assertCan` is `can` plus a throw, and separating them
would have put the cache in one file and its only consumers in another. `chain.ts` and
`target.ts` split out because building a scope chain from a path is pure and worth testing
without a database, while loading one is not. `actions.ts` is in `contracts` because a caller
knows what it is about to do, not which role that requires — keeping the mapping there means
"commenting requires a commenter" is one edit rather than a search through handlers.

## Implementation notes

- Resolution order is the whole design: collect all active grants for the subject along the chain, then pick by specificity, then apply deny override. Write it as a pure function over a grant list so it is trivially testable without a database.
- Use the materialized folder path from task `021` to fetch the ancestor chain in one query rather than a walk per level.
- Deny by default. `resolveAccess` returns no access unless a grant produces it — a new resource class must be unreachable until deliberately wired.
- `can_download` and `can_invite` resolve by the same specificity rule as role, independently. A viewer with download is legal; an editor without download is legal.
- Cache resolution per request, never across requests — a permission change must take effect on the next request (THREAT_MODEL T2).

## Security/privacy considerations

This package is the primary control for THREAT_MODEL T1 and T2. Deny-by-default, 404-shaped forbidden responses, and the lint boundary are all security controls. Any future code path that reads tenant data without passing through here is a vulnerability, which is why the rule is mechanical rather than a convention.

## Acceptance criteria

- [x] Grants may target folder, project, or song and inherit downward — proven against a real
      database two folder levels above the song, not only at the immediate parent.
- [x] The most specific active grant wins, including when it grants _less_: an owner narrowing
      one song to viewer is a thing people do, and "highest role wins" would ignore them.
- [x] An explicit deny at a child overrides an inherited allow — and, tested alongside it,
      does _not_ override a grant more specific than itself. Read carefully, the rule is that
      a deny beats what is less specific than it.
- [x] `can_download` and `can_invite` resolve independently of role. A viewer with download
      and an editor without both pass.
- [x] `resolveAccess` denies by default: no grants and no membership is `NO_ACCESS`, and a
      grant on a scope outside the target's chain is not a grant on the target.
- [x] `Forbidden` serializes 404-shaped. Asserted on `publicCode` and `httpStatus`, not only
      on the thrown type.
- [x] The lint rule fails a route handler importing `db` without `authz` — verified by writing
      one and watching lint reject it, then adding the import and watching it pass. See below.
- [x] Resolution is cached per request and never across requests: a revoked grant is gone for
      the next authorizer while the previous one still holds its answer, which is exactly why
      it must not outlive its request.

## Verification

```
@youandfriends/authz   47 tests   95.15% statements
@youandfriends/config 106 tests   (includes the rule's own RuleTester cases)
release-check: 8 gates, all pass
```

**The lint rule was verified against real code, not only in a unit test.** Task `010` shipped
a boundary rule that matched no files and enforced nothing, so this one was checked end to
end: a route importing `@youandfriends/db` alone was rejected by `pnpm --filter web lint`,
and the same file passed once it imported `@youandfriends/authz`. The `RuleTester` suite was
separately confirmed to fail when the rule is broken — five cases went red against a
deliberately disabled branch and green again when it was restored. A rule that never fires
reads as a control and enforces nothing.

## A bug the tests caught

`resolveFacet` returned its winning value bare, and the call site used `?? baseline`. For a
deny, the winning value for role is `null` — deliberately — so `??` fell straight through to
the workspace membership role. **A deny would have been silently ignored for any subject with
a membership**, which is almost everyone. It surfaced on the first run of "deny overrides the
workspace baseline". The facet resolver now returns a wrapper, so "nobody spoke" and "the
winner said no" are different answers rather than the same one.

## Decisions taken

- **Resolution is a pure function over a grant list.** Every rule is exercised by a table of
  cases rather than by fixtures; a resolution bug that only reproduces with a particular query
  is a bug nobody can reason about. Task `023` enumerates the matrix over the same function.
- **Facets resolve independently.** Role, download, and invite each walk the chain and stop at
  the first level that speaks, which is what makes viewer-with-download and
  editor-without-download both expressible. A single winning grant would force them to move
  together.
- **`can_download` and `can_invite` are nullable, not `false` by default.** Null means "this
  grant is silent", which is what lets a song-level role grant leave a folder-level download
  permission alone. A `false` default would revoke it, and the revocation would look
  deliberate.
- **A deny is not a fourth facet**, it is a grant that says "nothing, here" — so it wins at
  its level exactly as an allow would, and the specificity rule handles the rest.
- **A capability without a role resolves to false.** There is nothing to download if there is
  nothing you can see, and without this a stale download grant would survive a role deny as a
  bare `true`.
- **Active windows end exclusively.** A grant "until Friday" is over when Friday's timestamp
  arrives; the alternative leaves an access nobody can explain. An expired grant is not a
  deny — resolution falls through it to the next level, so a lapsed song grant restores
  inherited folder access rather than removing it.
- **The chain comes from the materialized path, at zero query cost.** `/A/B/C/` already _is_
  the ancestor list. This is what task `021` maintained it for.
- **The scoped handle takes an explicit table union**, not "any table with a `workspace_id`
  column". A structural constraint would silently accept a table that gains the column later
  without anyone deciding it should be readable that way.
- **`scopedQuery` refuses non-member subjects entirely.** A sync token or share-link bearer is
  authorized against a specific target, never a workspace; a workspace-wide handle would make
  a link to one song a key to everything (THREAT_MODEL T5).
- **The database test harness is now `@youandfriends/db/testing`.** Every later package that
  touches data needs the same real, isolated, migrated database; two harnesses would
  eventually disagree about what "migrated" means.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm lint
```

## Manual QA

1. Grant folder-level viewer, then song-level editor; confirm editor wins on that song and viewer elsewhere.
2. Add a song-level deny under a folder-level allow; confirm access is denied.
3. Write a route handler importing `db` directly; confirm lint rejects it.

## Rollback/compatibility

Central. Reverting breaks every authorized route. Grant semantics changes after collaborators exist require care — a resolution change can silently widen access, so task `023`'s matrix is the regression guard.

## Status

`complete`

## Commit

`50802b5`
