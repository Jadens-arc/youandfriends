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
packages/db/src/schema/audit.ts
packages/authz/src/audit.ts
packages/db/migrations/**
packages/authz/src/__tests__/audit.test.ts
```

## Implementation notes

- Emission must be **transactional with the action**. An audit write that can fail independently produces a log that is silently incomplete, which is worse than no log because it is trusted.
- Record the actor's subject type (member, sync token, share link) — 'who' is not always a user, and a sync upload attributed to a bare user id loses the device.
- Metadata must never contain a secret, a presigned URL, or a password verifier. Apply the task `002` redaction deny-list at write time, not only at log serialization.
- Carry the request correlation id so an audit row joins to structured logs during an investigation.

## Security/privacy considerations

Audit integrity is itself a security property. Append-only at the database level where possible. Metadata redaction is mandatory — an audit log that records credentials becomes a high-value target rather than a control.

## Acceptance criteria

- [ ] Every action class from `docs/DESIGN.md` §13 emits an audit event.
- [ ] Events are written in the same transaction as the audited change; a rolled-back action leaves no event.
- [ ] The table is append-only; update and delete are rejected.
- [ ] Actor subject type is recorded.
- [ ] Secrets, presigned URLs, and password verifiers never appear in metadata, proven by test.
- [ ] Correlation ids join audit rows to logs.

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

`pending`

## Commit

_(not yet)_
