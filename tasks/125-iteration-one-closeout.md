# 125 — Iteration one closeout and verification

**Phase:** Quality, release, closeout · **Iteration:** one

## Objective

Verify every one of the twelve iteration-one definition-of-done requirements end to end in a seeded environment, record evidence, and close the iteration honestly.

## User value

Confidence that iteration one is genuinely done — with evidence, not assertion.

## Scope

- Point-by-point verification of all twelve requirements in `docs/DESIGN.md` §14.
- Recorded evidence for each: the test, the command, or the manual verification that proves it.
- Confirmation that no required integration was replaced by a permanent mock.
- Confirmation that every deferred item has a numbered task rather than being silently omitted.
- `tasks/STATUS.md` fully accurate with every commit SHA recorded.
- A written closeout in `tasks/ITERATION_ONE.md` stating what works, what is deferred, and what is known-imperfect.
- The metadata-only closeout commit, exempt from the one-task rule as documented in `tasks/README.md`.

## Non-scope

- New features.
- Iteration two planning beyond the existing deferred tasks.
- Marketing or launch activity.

## Dependencies

`124`, and every other iteration-one task

## Files expected to change

```
tasks/STATUS.md
tasks/ITERATION_ONE.md
tasks/*.md
docs/DESIGN.md
```

## Implementation notes

- Verify each requirement **independently** and record how. A requirement marked done without evidence is exactly the unfounded completion claim `CLAUDE.md` forbids.
- Be honest about what is imperfect. A closeout that says 'gapless playback is best-effort on Safari and here is why' is worth more than one that claims gapless works.
- Check specifically for permanent mocks. The build prompt permits local adapters in tests but requires the real R2, Clerk, Neon, Liveblocks, and job paths to be implemented behind environment configuration — verify each.
- This task gets a **metadata-only closeout commit** because it has no successor to carry its SHA. That exemption is documented in `tasks/README.md` and must be referenced in the commit message.
- If a requirement is not met, the iteration is not complete. Record it as blocked with the precise reason rather than marking it done and moving on.

## Security/privacy considerations

Final security posture review: confirm the threat model's controls are implemented, the task `023` matrix passes, secret scanning is clean, and no credentials exist in the repository or its history.

## Acceptance criteria

- [ ] All twelve requirements in `docs/DESIGN.md` §14 are verified with recorded evidence.
- [ ] No required integration is a permanent mock; each real path is implemented behind configuration.
- [ ] Every deferred item has a numbered task.
- [ ] `tasks/STATUS.md` is accurate with every commit SHA recorded.
- [ ] `tasks/ITERATION_ONE.md` states what works, what is deferred, and what is imperfect.
- [ ] `pnpm release-check` passes in full.
- [ ] The threat model's controls are confirmed implemented.
- [ ] Secret scanning over the repository and history is clean.
- [ ] The closeout commit is metadata-only and references the documented exemption.

## Tests and validation commands

```bash
pnpm release-check
# Verify each of the twelve requirements individually, recording evidence
```

## Manual QA

1. Walk all twelve requirements end to end in a seeded environment.
2. Confirm each deferred item has a numbered task.
3. Read `tasks/ITERATION_ONE.md` and confirm it is honest about limitations.

## Rollback/compatibility

Metadata and documentation only. No runtime change. This commit is the documented exception to the one-task-per-commit rule.

## Status

`pending`

## Commit

_(not yet)_
