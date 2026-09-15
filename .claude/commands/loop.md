---
description: Run the task loop — select the earliest unblocked pending iteration-one task, implement it, validate it, commit it, and continue to the iteration-one milestone.
---

# /loop

Work the numbered plan autonomously until the iteration-one milestone is complete or a real
blocker occurs.

## Rules that govern the whole loop

- **One task, one commit.** Never combine, never split across implementation commits.
- **Never claim unfinished work is complete.**
- **Never** use `--no-verify`, destructive git resets, blanket test disabling, placeholder
  security, or fabricated provider responses.
- Stop at task `125` (the iteration-one milestone) unless explicitly told to continue.

## The loop

### 1. Read the status

```bash
cat tasks/STATUS.md
```

This is the canonical index. Read it first, every iteration.

### 2. Select the task

The earliest `pending` **iteration-one** task whose dependencies are all `complete`.

If the user named a task, work that one instead — but still verify its dependencies.

### 3. Verify dependencies and worktree

```bash
git status --porcelain
git log --oneline -5
```

- Every dependency must be `complete`. `in-progress` is not complete.
- The worktree must be clean, or every change understood and belonging to this task.

**Stop** if either fails.

### 4. Mark in progress

Set the task to `in-progress` in **both** `tasks/STATUS.md` and the task file.

Record the previous task's commit SHA now, per the protocol in `tasks/README.md` — it rides in
this task's commit. Never invent a SHA.

### 5. Invoke the relevant agents

Only the ones the task needs. Use the `orchestrator` handoff table:

| Domain                                               | Agent                    |
| ---------------------------------------------------- | ------------------------ |
| Design tokens, components, responsive, accessibility | `product-designer`       |
| Next.js, React, player, PWA, client upload           | `web-engineer`           |
| Schema, migrations, permissions, audit               | `data-authz-engineer`    |
| R2, multipart, ffmpeg, derivatives, waveforms        | `storage-media-engineer` |
| Tiptap, Yjs, Liveblocks, comments, notifications     | `realtime-engineer`      |
| Tauri agent, watching, snapshots, sync               | `mac-sync-engineer`      |

**Exactly one agent holds write ownership.** Read-only research and review agents may run in
parallel; writers never work on overlapping files.

### 6. Implement

Stay inside the task's declared scope and listed files. If the work turns out larger than the
task, **split the task** and update `tasks/STATUS.md` — do not quietly exceed it.

### 7. Run every validation

Every command in the task file's validation section, then:

```bash
pnpm release-check
```

Read the actual output. A summary line is not evidence.

**Stop** on any failure.

### 8. Request review

- `security-reviewer` — for anything touching auth, uploads, signed URLs, sharing,
  credentials, or tenant boundaries. Read-only.
- `test-reviewer` — before completing, always. Read-only.

Both may run in parallel.

### 9. Fix findings within scope

Fix what review found, **inside this task**. A finding needing work beyond the task becomes a
new numbered task — report it rather than silently widening this one.

Re-run validations after fixing.

### 10. Commit — exactly one

```bash
git add -A
git status
git commit -m "<NNN>: <imperative summary>"
```

Before committing, confirm nothing staged is a secret, credential, generated upload, local
database, test artifact, or user music.

### 11. Update tracking

Mark the task `complete` in the task file. Its SHA gets recorded in the **next** task's commit.

For task `125` only, follow with the metadata-only closeout commit, exempt per
`tasks/README.md`.

### 12. Continue

Return to step 1. Continue until the iteration-one milestone is complete or a stop condition
occurs.

## Stop conditions

Stop immediately, report the **exact** blocker and the safe next action, and do not improvise
past any of these:

- **A test or validation fails** that cannot be fixed within the task's scope.
- **A required credential is genuinely missing.** Never invent one, never stub the integration
  permanently.
- **A migration's destructive effect is ambiguous.** Ask the user.
- **An authorization question cannot be resolved** from `docs/THREAT_MODEL.md` and
  `packages/authz`.
- **The user has made unexpected changes** to the worktree.
- **The worktree is irreconcilably dirty.**
- A dependency is not actually complete.
- The task does not fit in one commit and cannot be cleanly split.
- A product or legal decision is required (tasks `208`, `209`, `215`).

## Report format

Each iteration:

```
── TASK <NNN>: <title> ──
DEPENDENCIES: verified complete
AGENTS: <implementer> (write) · <reviewers> (read-only)
CHANGES: <files>
VALIDATIONS:
  <command>: pass|fail
ACCEPTANCE: <n>/<n> — evidence named for each
REVIEWS: security: pass|<n> findings|n/a · test: ready|not ready
COMMIT: <sha>
NEXT: <NNN> — <title>
```

On stopping:

```
── LOOP STOPPED ──
AT TASK: <NNN> — <title>
STOP CONDITION: <which one>
BLOCKER: <exactly what is wrong, with output>
SAFE NEXT ACTION: <what the user should do>
STATE: <what is committed, what is not, worktree status>
```
