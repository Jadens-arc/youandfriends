---
name: authorization-check
description: Test the permission matrix and tenant boundaries for a change. Use whenever a change touches data access, roles, capabilities, subjects, or a new resource class.
---

# Authorization check

Tenant isolation failure is the worst outcome this product can produce. This procedure exists
to make that failure hard.

## When to use

Any change that reads or writes tenant-owned data, adds a resource class, touches
`packages/authz`, or introduces a new subject type.

## Steps

### 1. Identify every data access

```bash
grep -rn "@youandfriends/db" apps/web/app --include=*.ts --include=*.tsx
```

For each access, name the authorization check guarding it. An access without a named check is
a finding, not a judgment call.

### 2. Confirm the boundary is mechanical

```bash
pnpm lint
```

The `no-unscoped-db` rule must pass. If you are tempted to disable it, stop — that is the rule
working.

### 3. Verify resolution semantics

For any change to `packages/authz`:

- Most-specific-wins: song beats project beats folder beats workspace.
- Explicit deny at a child beats an inherited allow.
- `can_download` and `can_invite` resolve independently of role.
- Deny by default for anything not explicitly granted.
- Resolution caches per request, never across requests.

### 4. Register new resource classes

Every new sensitive resource class needs a cross-workspace IDOR test. The helper makes this
one line:

```ts
registerIdorCase('lyrics', { create: seedLyrics, read: readLyrics });
```

A class without an IDOR test fails the suite by design.

### 5. Confirm the 404 shape

Unauthorized access to a tenant-scoped resource returns **404-shaped**, not 403. A 403
confirms the resource exists, which is information disclosure.

```bash
pnpm --filter @youandfriends/authz test -- idor
```

### 6. Check aggregation surfaces

Search, activity feeds, notifications, and mention autocomplete return rows about **many**
objects. Each row must be filtered against access to its own target, not against workspace
membership. These are the highest-risk surfaces in the product.

### 7. Run the matrix

```bash
pnpm --filter @youandfriends/authz test
pnpm run generate:permission-matrix -- --check
```

The generated `docs/PERMISSION_MATRIX.md` must not be stale.

### 8. Verify audit

Access-changing actions emit an audit event **in the same transaction**. An event that can
fail independently produces a log that is silently incomplete.

## Stop conditions

- A data access has no identifiable authorization check.
- A change could widen access and you cannot prove otherwise.
- The lint boundary would need disabling.
- A permission requirement is unresolvable from `docs/DESIGN.md` §3 and
  `docs/THREAT_MODEL.md`.
- An aggregation surface cannot be filtered per target.

## Output

```
ACCESSES: <file>:<line> → <check> (one line each)
LINT BOUNDARY: pass|fail
RESOLUTION: specificity|deny-override|capabilities|deny-by-default — verified|n/a
NEW CLASSES: <name>: IDOR test registered
404 SHAPE: verified for <classes>
AGGREGATION SURFACES: <surface>: filtered per target — verified|n/a
MATRIX: pass|fail · generated doc current: yes|no
AUDIT: <actions> transactional — verified
```
