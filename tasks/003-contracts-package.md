# 003 — Shared contracts and validation boundary

**Phase:** Foundation · **Iteration:** one

## Objective

Establish `packages/contracts` as the single definition of every shape that crosses a trust
boundary: Zod schemas, inferred types, role and capability enums, and typed error codes.

## User value

Consistent, predictable error handling and a UI that cannot drift from the API's actual shape.

## Scope

- Zod schemas for core identifiers (ULID-shaped), pagination, and common value objects.
- `Role` (`viewer | commenter | editor | owner`) and capability booleans (`canDownload`,
  `canInvite`) as the canonical enums used by `authz`, the API, and the UI.
- A typed error taxonomy: `NotFound`, `Forbidden`, `Conflict`, `Validation`, `RateLimited`,
  `Internal`, each with a stable machine-readable code and a safe user-facing message.
- A `Result`-style helper for route handlers and a serializer that never leaks internals.
- Asset kind enum: `master | mix | stem | sample | project_file | artwork | voice_note`.

## Non-scope

- Feature-specific schemas. Each feature task adds its own schemas to this package.
- Any database or storage code.

## Dependencies

`000`, `001`

## Files expected to change

```
packages/contracts/src/{ids,roles,errors,pagination,assets,index}.ts
packages/contracts/src/__tests__/*.test.ts
```

## Implementation notes

- `Forbidden` must serialize to a **404-shaped** response at the API edge for tenant-scoped
  resources, so existence is not confirmed (THREAT_MODEL T1). The distinction is preserved
  internally for audit and kept out of the response body.
- Error messages returned to clients must be safe to display. Diagnostic detail goes to the
  log with a correlation ID, and the response carries the ID rather than the detail.
- Contracts must not import `db`, `storage`, or React. A lint boundary rule enforces this.

## Security/privacy considerations

The 404-shaped forbidden response is a deliberate security behavior, not a convenience. It is
tested explicitly. Error serialization is tested for the absence of stack traces, SQL, and
internal identifiers.

## Acceptance criteria

- [x] Role and capability enums are defined once and imported everywhere they are used.
- [x] Every error type has a stable code and a safe message.
- [x] Forbidden serializes 404-shaped for tenant-scoped resources.
- [x] Error serialization never includes stack traces or internal details.
- [x] `contracts` imports nothing from `db`, `storage`, or React; enforced by lint.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/contracts test
pnpm lint
```

## Manual QA

Not user-visible. Verified through consuming tasks.

## Rollback/compatibility

Additive and foundational. Reverting after dependent tasks land would break them — revert
those first.

## Status

`complete`

## Commit

`35dcb65`
