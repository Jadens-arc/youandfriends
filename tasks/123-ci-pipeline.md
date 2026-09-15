# 123 — Continuous integration pipeline

**Phase:** Quality, release, closeout · **Iteration:** one

## Objective

Configure GitHub Actions to run the quality gates on every push and pull request, with caching, a macOS job for the agent, and required status checks.

## User value

Nothing merges that breaks the build, without anyone having to remember to check.

## Scope

- A workflow running the full gate set on push and pull request.
- Service containers for Postgres and MinIO.
- ffmpeg installed for media fixture tests.
- A macOS job for the Tauri agent's clippy and tests.
- pnpm store, Turborepo, and Cargo caching.
- Playwright with browser caching.
- Required status checks documented for branch protection.
- Artifact upload for Playwright traces on failure.

## Non-scope

- Deployment automation (task `124`).
- Release or versioning automation.
- Self-hosted runners.

## Dependencies

`122`

## Files expected to change

```
.github/workflows/ci.yml
.github/workflows/README.md
docs/OPERATIONS.md
```

## Implementation notes

- Parallelize where the dependency graph allows, but keep the gate set identical to `release-check`. CI passing while local `release-check` fails (or the reverse) destroys trust in both.
- The macOS runner is slower and more expensive. Run the agent job only when `apps/sync-mac` or shared contracts change, and say so in the workflow.
- Cache the pnpm store, Turborepo artifacts, Cargo registry and target, and Playwright browsers. Without caching this pipeline is slow enough that people work around it.
- Upload Playwright traces on failure — debugging a CI-only e2e failure without a trace is miserable.
- Never put real credentials in CI. Tests use MinIO, local Postgres, and generated fixtures (task `120`).
- Document which checks should be required for branch protection; the setting itself is repository configuration, not code.

## Security/privacy considerations

CI must not have access to production credentials. All tests run against local service containers and generated fixtures. Secret scanning runs in CI (task `122`). Workflow permissions follow least privilege — explicitly scope the `GITHUB_TOKEN` rather than accepting defaults.

## Acceptance criteria

- [ ] The workflow runs the full gate set on push and pull request.
- [ ] Postgres and MinIO run as service containers; ffmpeg is installed.
- [ ] A macOS job runs the agent's clippy and tests, conditionally on relevant changes.
- [ ] pnpm, Turborepo, Cargo, and Playwright caches are configured and effective.
- [ ] Playwright traces upload on failure.
- [ ] The CI gate set matches `release-check` exactly.
- [ ] No production credentials exist in CI.
- [ ] Workflow token permissions are explicitly least-privilege.
- [ ] Required status checks are documented.

## Tests and validation commands

```bash
pnpm release-check   # must match CI exactly
# Push a branch and confirm the workflow runs green
```

## Manual QA

1. Open a pull request and confirm every gate runs.
2. Break a test and confirm CI fails with a useful trace artifact.
3. Confirm cache hits on a second run.

## Rollback/compatibility

CI configuration only. Reverting removes automated verification.

## Status

`pending`

## Commit

_(not yet)_
