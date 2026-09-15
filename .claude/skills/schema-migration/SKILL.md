---
name: schema-migration
description: Safe Drizzle and Neon migration procedure, including the expand/migrate/contract path for destructive changes. Use for any database schema change.
---

# Schema migration

Migrations are the one class of change that can destroy data irreversibly. This procedure is
not optional.

## When to use

Any change to `packages/db/src/schema/**`.

## Steps

### 1. Design

- Every tenant-owned table needs `workspace_id` with it as the **leading** column of composite
  indexes.
- Decide now whether the change is additive or destructive. Destructive means dropping a
  column or table, narrowing a type, adding a NOT NULL without a default, or renaming.

### 2. Generate and read

```bash
pnpm --filter @youandfriends/db generate
```

**Read the generated SQL.** Generated migrations are not automatically correct — check for
unintended drops, table rewrites on large tables, and missing indexes.

### 3. Dry run against an isolated branch

```bash
pnpm --filter @youandfriends/db migrate:dry
```

Never skip this. Neon branching is cheap; a bad production migration is not.

### 4. Destructive changes: expand → migrate → contract

A destructive change **never** lands in one deploy. Three separate deploys:

1. **Expand** — add the new structure. Write to both old and new. Read from old. Deploy.
2. **Migrate** — backfill the new structure. Switch reads to new. Deploy.
3. **Contract** — stop writing old. Deploy. Then drop the old structure in a later migration.

Each phase is its own task and its own commit. If the phases are not separated, the change is
not safe.

**Stop and ask the user** if the destructive effect on existing data is ambiguous in any way.

### 5. Backfill

Large backfills run in batches with progress, and must be resumable. A single `UPDATE` across
a large table locks it.

### 6. Validate

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/db migrate:dry
```

Confirm new sensitive resource classes are registered in the task `023` IDOR suite.

### 7. Apply

```bash
pnpm --filter @youandfriends/db migrate
```

Migrations run **before** deploying code that depends on them (`docs/OPERATIONS.md` §1).

Take a logical dump first for any destructive migration:

```bash
pg_dump "$DATABASE_URL" -Fc -f "youandfriends-$(date +%Y%m%d).dump"
```

## Stop conditions

- The dry run fails or shows an unexpected effect.
- The destructive impact on existing data is ambiguous. **Ask the user.**
- A backfill would lock a large table.
- The change would remove `workspace_id` or its leading index from a tenant-owned table.
- Rollback cannot be described precisely.

## Output

```
MIGRATION: <file>
TYPE: additive | destructive (phase <n> of 3)
SQL REVIEWED: yes — <anything notable>
TENANT SCOPING: <table>: workspace_id + leading index — verified
DRY RUN: pass|fail
BACKFILL: none | batched, resumable, <row estimate>
IDOR REGISTRATION: <classes> | n/a
ROLLBACK: <precise procedure>
```
