# You & Friends — Task Plan

_A private music workspace by Avery and Friends._

`/tasks` is the complete plan and execution state machine for the product. It is **not** a
source directory — application code lives in `apps/` and `packages/`.

## How to read this directory

- `STATUS.md` is the canonical index: number, title, phase, dependencies, status, commit SHA,
  and blocker. **It is the file to read first, always.**
- `NNN-slug.md` is one task. Numbers are zero-padded and ordered by dependency.
- Tasks `000`–`125` are **iteration one**. Tasks `200`+ are **deferred** — planned, numbered,
  and dependency-linked, but explicitly out of iteration-one scope.

## The one-task-per-commit protocol

One task corresponds to exactly one implementation commit. Commit messages begin with the
task number:

```
012: add multipart upload finalization
```

Never combine two tasks in a commit. Never spread one task across several implementation
commits. If a task is too large to land in one commit, **split the task before coding** — add
`NNNa`/`NNNb` or renumber, update `STATUS.md`, and say so in the task file.

Task `000` is the single exception granted up front: it may create the plan, the Claude
configuration, and the monorepo scaffolding in one commit.

### The commit-SHA recording protocol

A task file cannot contain its own commit SHA, because the SHA does not exist until the commit
is made. The safe protocol:

1. Implement task `N`. Run every validation in its task file.
2. Commit as `N: <summary>`. This is task `N`'s implementation commit.
3. Record the resulting SHA in `STATUS.md` and in task `N`'s `Commit:` field **as part of
   task `N+1`'s commit**.

So each implementation commit carries its own code plus the previous task's metadata. This is
deliberate and is not a violation of the one-task rule.

**Closeout exception.** The final task of an iteration (`125`) has no successor to carry its
metadata. It is therefore followed by a **metadata-only closeout commit**, explicitly exempt
from the one-task-per-commit rule, containing nothing but status updates. Its message is
`125: record closeout metadata (metadata-only, exempt)`.

## Status values

| Status        | Meaning                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `pending`     | Not started. Dependencies may or may not be met.                                    |
| `in-progress` | Claimed by exactly one agent with write access.                                     |
| `blocked`     | Cannot proceed. The blocker is recorded precisely in the task file and `STATUS.md`. |
| `complete`    | All acceptance criteria met, all validations passed, commit SHA recorded.           |

A task is never marked `complete` with a failing test or an unmet acceptance criterion. If
work is partially done, it stays `in-progress` or becomes `blocked` with the reason stated.

## Required sections in every task file

Objective · User value · Scope · Non-scope · Dependencies · Files expected to change ·
Implementation notes · Security/privacy · Acceptance criteria · Tests and validation commands ·
Manual QA · Rollback/compatibility · Status · Commit

## Phases

| Range   | Phase                                | Iteration |
| ------- | ------------------------------------ | --------- |
| 000–009 | Foundation and tooling               | one       |
| 010–019 | Studio Notebook design system        | one       |
| 020–029 | Data model, authorization, audit     | one       |
| 030–039 | Authentication and workspace         | one       |
| 040–049 | Library navigation                   | one       |
| 050–059 | Upload, storage, versions            | one       |
| 060–069 | Media pipeline                       | one       |
| 070–079 | Persistent player                    | one       |
| 080–089 | Collaborative lyrics                 | one       |
| 090–099 | Comments, voice notes, notifications | one       |
| 100–109 | Mobile and PWA                       | one       |
| 110–119 | macOS sync agent                     | one       |
| 120–129 | Quality, release, closeout           | one       |
| 200–299 | Deferred product work                | later     |
