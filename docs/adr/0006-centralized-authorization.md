# ADR 0006: Authorization lives in one package, never in route handlers

- **Status:** accepted
- **Date:** 2026-09-15
- **Task:** 000

## Context

Permissions in You & Friends are genuinely subtle: grants target folders, projects, or songs;
they inherit downward; the most specific grant wins; an explicit deny at a child beats an
inherited allow; `can_download` and `can_invite` are independent of role; share-link bearers
are authorized on a separate path that must never confer membership; and every tenant-owned
row is workspace-scoped.

Subtle rules scattered across dozens of route handlers as ad hoc `if (role === 'editor')`
comparisons are how tenant isolation bugs happen. Each site drifts, and no single place can
be tested.

## Decision

All authorization decisions resolve through **`packages/authz`**. No route handler, server
action, or component performs a role comparison.

The surface is deliberately small:

```ts
resolveAccess(subject, target): Promise<EffectiveAccess>
assertCan(subject, action, target): Promise<void>  // throws a typed ForbiddenError
scopedQuery(subject, workspaceId): ScopedDb        // pre-filtered db handle
```

Three supporting rules:

1. **Deny by default.** `resolveAccess` returns no access unless a grant produces it. A new
   resource class is unreachable until deliberately wired, rather than accidentally public.
2. **Audit in the same transaction.** Access-changing actions write `audit_events`
   atomically with the change. A permission grant that is not audited is a bug.
3. **A lint rule** (task `022`) forbids importing `@youandfriends/db` from route handlers
   without `@youandfriends/authz`, so the boundary is mechanically enforced rather than
   maintained by discipline.

The permission matrix is executable, not prose. `packages/authz/src/__tests__/matrix.test.ts`
enumerates role × capability × scope depth × deny-override, and every sensitive resource class
carries a cross-workspace IDOR test that asserts a 404-shaped failure.

## Consequences

**Easier:** One place to read, reason about, test, and fix. A permission bug is fixed once.
New resource classes inherit correct behavior by construction.

**Harder:** An indirection layer between routes and data, and a discipline the codebase must
hold. The lint rule carries that weight so the rule survives contributors who have not read
this ADR.

**Accepted:** `scopedQuery` costs a small amount of ergonomics versus reaching for the raw
Drizzle client. That friction is the point.

## Consequences if violated

A single handler that queries by ID without a workspace check is a cross-tenant data leak.
This is the highest-severity failure mode in the product, which is why it gets mechanical
enforcement rather than a code-review convention.

## Alternatives considered

**Postgres row-level security** — enforcement at the strongest possible layer, and genuinely
attractive. Rejected for iteration one because our rules (most-specific-wins with deny
override across a materialized folder path) are awkward to express in RLS policies, and
because Neon's pooled connections complicate reliable per-request session variables. Revisit
as defense in depth once the matrix is stable.

**A policy engine (OPA/Cedar)** — expressive and auditable, but a large dependency and a
second language for a rule set that fits comfortably in tested TypeScript.

**Per-route checks with a shared helper** — the common approach, and the one that drifts. A
helper that is merely available is not a helper that is always used.
