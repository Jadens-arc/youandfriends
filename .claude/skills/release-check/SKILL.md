---
name: release-check
description: Run every quality gate — lint, types, units, integration, Playwright, migrations, build, security, and docs — and report honestly. Use before marking any task complete.
---

# Release check

One command that answers "is this safe to ship". This skill is about running it and reading
the result honestly.

## When to use

Before marking any task complete. Before any deployment. After resolving a review finding.

## The gates, in order

Fast to slow, so a format error fails in seconds rather than after a ten-minute browser run.

```bash
pnpm release-check
```

| #   | Gate                        | Fails on                                      |
| --- | --------------------------- | --------------------------------------------- |
| 1   | format                      | misformatted files                            |
| 2   | lint                        | violations, including the authz boundary rule |
| 3   | typecheck                   | any type error under strict                   |
| 4   | unit                        | failing unit tests                            |
| 5   | db/authz integration        | failing permission or schema tests            |
| 6   | storage contract (MinIO)    | protocol behavior drift                       |
| 7   | media fixture (ffmpeg)      | pipeline regressions                          |
| 8   | Rust clippy + tests (macOS) | agent warnings or failures                    |
| 9   | Playwright desktop + iPhone | broken critical paths                         |
| 10  | production build            | build errors                                  |
| 11  | migration dry run           | bad migration                                 |
| 12  | dependency audit            | vulnerabilities at or above threshold         |
| 13  | secret scan                 | credentials in tree or history                |

## Steps

### 1. Prerequisites

```bash
docker compose -f docker-compose.test.yml up -d    # Postgres + MinIO
ffmpeg -version                                     # media fixtures
pnpm exec playwright install --with-deps            # first run only
```

Missing prerequisites cause a **loud skip**, never a silent pass. A gate that quietly passes
when its prerequisite is absent is a lie in the build output.

### 2. Run

```bash
pnpm release-check
```

### 3. Read the output honestly

- A summary line is not evidence. Confirm what actually ran.
- A skipped gate is not a passing gate. Note which skipped and why.
- If anything failed, the task is not complete.

### 4. On failure

The output names the gate and the exact reproduction command. Run it, fix the cause, re-run
the full check.

**Never**: `--no-verify`, `.skip` on a failing test, loosening an assertion, disabling a lint
rule, or lowering a threshold to achieve green. If a gate is genuinely wrong, that is its own
numbered task, not an inline workaround.

### 5. Before committing

```bash
git status
git diff --cached
```

Confirm nothing staged is a secret, a credential, a generated upload, a local database, a
Playwright trace, coverage output, or user music.

## Stop conditions

- Any gate fails.
- A gate skips and the change under review depends on what it would have verified.
- A secret is detected — **rotate it**; removing the commit is insufficient because it remains
  in history.
- A dependency vulnerability at or above threshold has no documented exception.

## Output

```
RELEASE CHECK
  format: pass|fail
  lint: pass|fail
  typecheck: pass|fail
  unit: pass|fail (<n> tests)
  db/authz: pass|fail
  storage contract: pass|fail|skipped (MinIO unavailable)
  media fixture: pass|fail|skipped (ffmpeg unavailable)
  rust: pass|fail|skipped (non-macOS)
  playwright: pass|fail (desktop, iPhone)
  build: pass|fail
  migration dry run: pass|fail
  dependency audit: pass|fail (<n> at/above threshold)
  secret scan: clean|FINDINGS

VERDICT: shippable | not shippable
SKIPPED: <gates and why> | none
BLOCKER: <gate and reproduction command> | none
```
