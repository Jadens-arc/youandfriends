# 006 — Threat model the operator tooling that writes outside the request path

**Phase:** Foundation · **Iteration:** one

## Objective

Add a numbered threat covering developer and operator tooling that writes to, or deletes from, a
database directly — seeds, migrations, purge jobs, future backfills — and hold the existing
tools to it.

## User value

Indirect, and the largest blast radius in the repository. Every control in
`docs/THREAT_MODEL.md` today assumes a request: a subject, a workspace, an authorizer. The CLIs
in `packages/db/bin/` have none of those. They are operated by a person at a shell, hold
unrestricted credentials, and are the only code that can destroy a workspace's contents in one
command. Nothing currently states what they are required to do before they write.

## Scope

- A new `T10 — operator tooling and environment targeting` section in `docs/THREAT_MODEL.md`,
  stating at minimum:
  - a destructive or writing CLI validates its **target**, not just its environment label;
  - it names what it is about to write to, before it writes;
  - its deletes are scoped to what it owns, by identifier, not by a broad predicate;
  - it runs in one transaction, so a refusal partway through is not a half-finished state;
  - it fails closed on every dimension it checks.
- An audit of the three existing CLIs (`seed.mjs`, `migrate.mjs`, `purge.mjs`) against it, and a
  task recorded for anything that does not comply.
- Whether the same rule should extend to `migrate` is the open question: a migration against the
  wrong database is at least as bad as a seed against it, and today `migrate.mjs` checks
  nothing about its target.

## Non-scope

- Changing `purge.mjs`'s retention semantics, which task `025` settled.
- Access control for a hosted admin surface — that is task `207`, iteration two.
- Re-litigating the seed guard, which task `027` already implemented to this standard.

## Dependencies

`027`

## Files expected to change

```
docs/THREAT_MODEL.md
tasks/STATUS.md
```

## Implementation notes

- The gap was found by the security review of task `027`, which observed that `T8` covers
  deletion **by users** and nothing covers deletion **by operators**. Task `027` closed the
  instance; this closes the class.
- `packages/db/src/seed/guard.ts` is the worked example, including the `SeedPermit` pattern: a
  branded value the guard returns and the destructive functions require, so a caller cannot
  reach them without passing the check. Write the rule so that pattern is the expected shape and
  not a one-off.
- `migrate.mjs` is the interesting case and should be decided, not assumed. A migration is
  supposed to run against production — that is the point of it — so "refuse a remote host" is
  the wrong rule there. Naming the target before applying is likely the right one.

## Security/privacy considerations

This task _is_ the security consideration. The one concrete finding behind it: with
`NODE_ENV=development` exported in a shell — the ordinary development state — and a production
connection string in `.env.local` — a normal thing to have while debugging an incident — the
seed as first written would have passed every check and written fabricated users, workspaces,
and permission grants into production. The environment label was never the target.

## Acceptance criteria

- [ ] `docs/THREAT_MODEL.md` has a `T10` section covering operator tooling.
- [ ] It states the target-validation, announce-before-write, scoped-delete, transactional, and
      fail-closed requirements.
- [ ] Each existing CLI is assessed against it in writing, and non-compliance is a recorded task
      rather than a note.
- [ ] The `migrate.mjs` question is answered either way, with the reasoning.

## Tests and validation commands

```bash
pnpm release-check
```

## Manual QA

1. Read `T10` against `packages/db/bin/seed.mjs` and confirm the rule describes what it does.

## Rollback/compatibility

Documentation and task records. Nothing to roll back.

## Status

`pending`

## Commit

_(not yet)_
