---
name: task-lifecycle
description: Claim, validate, commit, and close a numbered task following the one-task-per-commit protocol. Use at the start and end of every task in /tasks.
---

# Task lifecycle

The standard path for working a numbered task. Deviating from it breaks the commit protocol
and makes `tasks/STATUS.md` untrustworthy.

## When to use

Every time you start or finish a task in `/tasks`. No exceptions.

## Steps

### 1. Claim

```bash
cat tasks/STATUS.md
git status --porcelain
git log --oneline -5
```

- Confirm the task is `pending` and every dependency is `complete`.
- Confirm the worktree is clean, or that every change is understood and belongs to this task.
- Read the task file in full — all fourteen sections.
- Set the task to `in-progress` in **both** `tasks/STATUS.md` and the task file.

**Stop if** a dependency is not complete, or the worktree is dirty in a way you cannot
explain.

### 2. Record the previous task's SHA

If the previous task completed and its SHA is not yet recorded:

```bash
git log --oneline -3
```

Write that SHA into `tasks/STATUS.md` and the previous task file's `Commit:` field. This
metadata rides along in **this** task's commit — that is the protocol in `tasks/README.md`.

**Never invent a SHA.** If you cannot find it, stop and say so.

### 3. Implement

Stay within the task's declared scope and its listed files. If the work turns out larger than
the task, **split the task** — do not quietly exceed it.

### 4. Validate

Run every command in the task file's "Tests and validation commands" section, then:

```bash
pnpm release-check
```

Read the output. A summary line is not evidence; the actual result is.

**Stop if** anything fails. Fix it or record a blocker. Never use `--no-verify`, never skip a
failing test, never loosen an assertion to get green.

### 5. Review

- Request `security-reviewer` if the task touches auth, uploads, signed URLs, sharing,
  credentials, or tenant boundaries.
- Request `test-reviewer` before completing, always.
- Fix findings **within this task's scope**. Findings needing more become new numbered tasks.

### 6. Verify acceptance criteria

Walk the task file's checkboxes one at a time. For each, name the evidence. A criterion
without evidence is unmet, and an unmet criterion means the task is not complete.

### 7. Commit

```bash
git add -A
git status              # review exactly what is staged
git commit -m "<NNN>: <imperative summary>"
```

The message begins with the task number. One task, one commit.

Before committing, confirm no secret, credential, generated upload, local database, or media
fixture beyond what the task requires is staged.

### 8. Close

Set the task to `complete` in the task file. Its SHA gets recorded in the **next** task's
commit, per the protocol.

For task `125` only, make the metadata-only closeout commit:

```bash
git commit -m "125: record closeout metadata (metadata-only, exempt per tasks/README.md)"
```

## Stop conditions

Stop and report precisely — do not improvise past any of these:

- a dependency is not complete
- a validation fails
- the worktree is dirty and unexplained
- a required credential is missing
- a migration's destructive effect is ambiguous
- an authorization question is unresolved
- the user has made unexpected changes
- the work does not fit in one commit

## Output

```
TASK: <number> — <title>
STATUS: in-progress → complete | blocked
PREVIOUS SHA RECORDED: <sha> | n/a
VALIDATIONS: <command>: pass|fail (one line each)
ACCEPTANCE: <n>/<n> — evidence named for each
REVIEWS: security: pass|findings|n/a · test: ready|not ready
COMMIT: <sha>
BLOCKER: <precise description, or none>
```
