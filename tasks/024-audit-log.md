# 024 — Audit log

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Record every authentication, access, sharing, permission change, upload, edit, download, deletion, restoration, and administrative action as an immutable audit event written in the same transaction as the action.

## User value

An owner can answer 'who did that, and when' — and recover confidently, because the history is intact.

## Scope

- `audit_events`: workspace, actor (including subject type), action, target type and id, metadata, correlation id, timestamp.
- Emission helper called inside the same transaction as the audited change.
- Append-only enforcement: no update or delete path, enforced by database permissions where possible.
- Coverage for the event classes named in `docs/DESIGN.md` §13.
- An owner-facing query path (the UI is deferred to `207`).

## Non-scope

- An administration console UI (deferred `207`).
- Log shipping or long-term archival.
- Tamper-evident hash chaining — noted as a possible future hardening.

## Dependencies

`022`

## Files expected to change

```
packages/contracts/src/audit.ts
packages/db/src/schema/audit.ts
packages/db/migrations/0002_audit_events.sql
packages/authz/src/{audit,audit-query}.ts
packages/authz/src/authorizer.ts
packages/authz/src/__tests__/{audit.test.ts,resources.ts,idor.test.ts}
docs/OPERATIONS.md §4b
```

The vocabulary lives in `contracts` for the reason every other enum does: the database, the
API, and the UI must read one list. `audit-query.ts` is separate from `audit.ts` because
reading and writing have different access rules — writing happens inside an action that was
already authorized, reading is owner-only.

## Implementation notes

- Emission must be **transactional with the action**. An audit write that can fail independently produces a log that is silently incomplete, which is worse than no log because it is trusted.
- Record the actor's subject type (member, sync token, share link) — 'who' is not always a user, and a sync upload attributed to a bare user id loses the device.
- Metadata must never contain a secret, a presigned URL, or a password verifier. Apply the task `002` redaction deny-list at write time, not only at log serialization.
- Carry the request correlation id so an audit row joins to structured logs during an investigation.

## Security/privacy considerations

Audit integrity is itself a security property. Append-only at the database level where possible. Metadata redaction is mandatory — an audit log that records credentials becomes a high-value target rather than a control.

## Acceptance criteria

- [x] Every action class from `docs/DESIGN.md` §13 has actions defined and round-trips through
      the helper — a test writes one event of each of the ten classes and reads them back.
      Each action names the task that wires its real emission point, so an unwired action is
      visible rather than merely absent. `access.*` is wired here.
- [x] Events are written in the same transaction as the audited change; a rolled-back action
      leaves no event, proven by rolling one back and asserting both the absent event and the
      surviving row.
- [x] The table is append-only: `UPDATE`, `DELETE`, **and `TRUNCATE`** are rejected by
      database triggers, for every caller including the role the application connects as.
- [x] Actor subject type is recorded, including the anonymous case, which has no id.
- [x] Secrets, presigned URLs, and sync tokens never appear in metadata — asserted against the
      raw `jsonb` column, not the parsed value.
- [x] Correlation ids join audit rows to logs.

## Verification

```
@youandfriends/authz  487 tests   99.29% statements   97.22% functions
release-check: 10 gates, all pass
```

## Three things the tests caught

**A `TRUNCATE` hole.** Row-level triggers do not fire for `TRUNCATE`, so the table would have
been append-only right up until someone reached for the fast way to empty it. A statement-level
trigger closes it.

**A false claim in my own migration comment.** I wrote that cascading deletes do not fire row
triggers. They do — a cascade issues a real `DELETE`. The test that asserted a workspace delete
removes its events failed, which is how the claim was found. See the decision below.

**Non-monotonic ids.** The first id generator used a millisecond timestamp plus randomness.
Several events written in one transaction — "renamed, then deleted" — share a timestamp, so
they sorted arbitrarily and an investigation would have read the effect before the cause. Ids
are now monotonic within a millisecond, and a test asserts 200 consecutive ids sort in issue
order.

## Decisions taken

- **There is no bare `recordAuditEvent(db, …)`.** The only way in is `withAuditedTransaction`,
  which hands the caller a transaction and an emitter already bound to it. Forgetting to use
  the same transaction is not a mistake that can be made, because no other transaction is on
  offer.
- **Deleting a workspace is refused while its audit events exist.** A cascade would destroy
  the record as a side effect of another action — and, since a cascade is a real `DELETE`, it
  would trip the append-only trigger and fail confusingly anyway. Refusing at the foreign key
  says the true thing: purging a tenant's history is a deliberate retention procedure, which
  `docs/DESIGN.md` §13 already lists as work to complete before public launch.
- **`audit_events` is deliberately unreachable through `scopedQuery`.** Its registry entry
  carries `table: null`, so the only read path is `queryAuditEvents`, which requires workspace
  ownership. That is stronger than including it: an unguarded read is not one call away.
- **The decision sink is awaited.** It was synchronous, which would have made an audit write
  from it fire-and-forget — the silently-incomplete log ADR 0006 rules out, where the failure
  is invisible and the record is trusted anyway. A test asserts a failing sink fails the
  decision.
- **Access events are opt-in, not automatic.** A permission check runs on every read in the
  product; a row per check would drown the log it exists to make readable. `auditDecisions`
  takes `onlyRefusals` for the common case.
- **No `updated_at` column.** A row that can be updated is not append-only, and a column
  inviting it would be a standing suggestion.
- **Rows are ordered by id, not timestamp.** Two events in one transaction share a timestamp;
  the id is what preserves the order they happened in.

## A cross-task guard that worked

Task `023`'s resource registry caught this task adding a tenant-owned table. The suite failed
with `unregistered tenant-owned tables: audit_events` and, separately, told me to convert the
pending entry rather than delete it. That is the mechanism working on the very next task that
could have skipped it.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/db test
```

## Manual QA

1. Change a permission, confirm the audit row exists with the right actor and target.
2. Force a rollback mid-action and confirm no orphan audit row remains.

## Rollback/compatibility

Additive. Reverting loses the compliance and recovery record. Once real events exist they must be preserved — a later schema change follows expand/migrate/contract.

## Status

`complete`

## Commit

`7ac4205`
