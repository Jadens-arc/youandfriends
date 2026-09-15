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
packages/authz/src/{resolve,assert,scoped-query,subjects,index}.ts
packages/db/src/schema/permissions.ts
packages/config/src/eslint/rules/no-unscoped-db.mjs
packages/authz/src/__tests__/smoke.test.ts
```

## Implementation notes

- Resolution order is the whole design: collect all active grants for the subject along the chain, then pick by specificity, then apply deny override. Write it as a pure function over a grant list so it is trivially testable without a database.
- Use the materialized folder path from task `021` to fetch the ancestor chain in one query rather than a walk per level.
- Deny by default. `resolveAccess` returns no access unless a grant produces it — a new resource class must be unreachable until deliberately wired.
- `can_download` and `can_invite` resolve by the same specificity rule as role, independently. A viewer with download is legal; an editor without download is legal.
- Cache resolution per request, never across requests — a permission change must take effect on the next request (THREAT_MODEL T2).

## Security/privacy considerations

This package is the primary control for THREAT_MODEL T1 and T2. Deny-by-default, 404-shaped forbidden responses, and the lint boundary are all security controls. Any future code path that reads tenant data without passing through here is a vulnerability, which is why the rule is mechanical rather than a convention.

## Acceptance criteria

- [ ] Grants may target folder, project, or song and inherit downward.
- [ ] The most specific active grant wins.
- [ ] An explicit deny at a child overrides an inherited allow.
- [ ] `can_download` and `can_invite` resolve independently of role.
- [ ] `resolveAccess` denies by default for an unwired resource class.
- [ ] `Forbidden` serializes 404-shaped for tenant-scoped resources.
- [ ] The lint rule fails a route handler importing `db` without `authz`.
- [ ] Resolution is cached per request and never across requests.

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

`pending`

## Commit

_(not yet)_
