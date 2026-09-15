# 122 — Complete release check, dependency and secret scanning

**Phase:** Quality, release, closeout · **Iteration:** one

## Objective

Finish `pnpm release-check` so it runs every gate, and add dependency vulnerability and secret scanning with a decided failure threshold.

## User value

One command that answers 'is this safe to ship' honestly.

## Scope

- `release-check` running, in order: format, lint, typecheck, unit, db/authz integration, storage contract, media fixture, Rust clippy and tests, Playwright desktop and iPhone, production build, migration dry run, dependency audit, secret scan.
- Dependency vulnerability scanning with a decided severity threshold and a documented exception process.
- Secret scanning across the repository and its history.
- Clear reporting: which gate failed, why, and the exact command to reproduce.
- Loud skips for gates whose prerequisites are absent, never silent passes.
- Documented expected runtime so people know what they are committing to.

## Non-scope

- CI workflow definition (task `123`).
- Continuous dependency update automation.
- Penetration testing.

## Dependencies

`118`, `120`, `121`

## Files expected to change

```
scripts/release-check.mjs
package.json
.gitleaks.toml
docs/OPERATIONS.md
```

## Implementation notes

- Order gates fast-to-slow. A format error should fail in seconds, not after a ten-minute Playwright run.
- Decide the dependency threshold explicitly and document the exception process. 'Fail on high and critical, with documented exceptions' is a policy; 'fail on anything' produces a permanently red build that everyone learns to ignore.
- Scan git history for secrets, not just the working tree. A secret committed and then removed is still in history and still compromised.
- Loud skips throughout — consistent with tasks `052`, `066`, `111`, `118`. A gate that silently passes when its prerequisite is missing is a lie in the build output.
- Report the reproduction command for each failure. 'Playwright failed' sends people hunting; `pnpm test:e2e -- --grep "upload"` does not.

## Security/privacy considerations

Secret scanning is a direct T9 control. Dependency scanning addresses supply-chain risk. Both must fail the build at the decided threshold rather than warning into a log nobody reads.

## Acceptance criteria

- [ ] `release-check` runs every listed gate in fast-to-slow order.
- [ ] Dependency scanning fails at the documented severity threshold with a documented exception process.
- [ ] Secret scanning covers the working tree and git history.
- [ ] Each failure names the gate and the exact reproduction command.
- [ ] Absent prerequisites cause loud skips, never silent passes.
- [ ] Expected runtime is documented.
- [ ] A deliberately introduced secret is caught.

## Tests and validation commands

```bash
pnpm release-check
pnpm release-check --list   # show gates and expected duration
```

## Manual QA

1. Introduce a fake secret, run the scan, confirm it is caught, remove it.
2. Break each gate in turn and confirm the failure message is actionable.
3. Run with MinIO and ffmpeg absent; confirm loud skips.

## Rollback/compatibility

Script and config only. Reverting weakens the quality bar without changing runtime behavior.

## Status

`pending`

## Commit

_(not yet)_
