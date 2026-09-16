# You & Friends — Agent Operating Rules

_A private music workspace by Avery and Friends._ · `youandfriends.org`
_Where songs live between sessions._

These rules are binding for every agent working in this repository. They exist because this
product stores irreplaceable work — unreleased music and unpublished lyrics — for people who
trusted it with them.

## 1. Read before you write

Before editing anything:

1. **`tasks/STATUS.md`** — the canonical index. Always first.
2. **The selected task file** — every section, not just the objective.
3. **Relevant documentation** — `docs/DESIGN.md` for product and visual behavior,
   `docs/ARCHITECTURE.md` for structure, `docs/THREAT_MODEL.md` for anything touching auth,
   uploads, sharing, or tenant boundaries, and the relevant ADRs.
4. **The existing code** in the area you are changing.

Reading the task file is not optional and is not satisfied by skimming. Its acceptance
criteria are the definition of done.

## 2. Task selection

- Work the **earliest unblocked pending task** unless the user names another.
- Verify every dependency is `complete` before starting. A dependency that is `in-progress`
  is not met.
- Mark the task `in-progress` in `tasks/STATUS.md` and the task file before writing code.
- `/loop` stops at the iteration-one milestone (task `125`) unless explicitly told to continue.

## 3. One task, one commit

- One task corresponds to **exactly one implementation commit**.
- Commit messages begin with the task number: `012: add multipart upload finalization`.
- Never combine tasks in a commit. Never spread a task across implementation commits.
- If a task is too large to land in one commit, **split the task before coding** — update
  `tasks/STATUS.md` and say so in the task file. Do not silently exceed scope.
- Task `000` may combine plan and scaffolding. Task `125` is followed by a metadata-only
  closeout commit. These are the only two exceptions, both documented in `tasks/README.md`.

### Recording commit SHAs

A task file cannot contain its own SHA. Follow the protocol in `tasks/README.md`: implement
and commit task `N`, then record `N`'s SHA in `tasks/STATUS.md` and `N`'s task file **as part
of task `N+1`'s commit**. Never invent, guess, or placeholder a SHA.

## 4. Ownership and parallelism

- **Exactly one agent holds write access for a task.** Research and review agents are
  read-only unless ownership is explicitly handed over.
- **Parallel agents must never edit overlapping files.** If two pieces of work touch the same
  file, they are sequential, not parallel.
- Read-only research and review may run in parallel freely.
- Agents must not recursively spawn uncontrolled agents. An agent may be asked to do work; it
  does not build its own org chart.

## 5. Keep main green

- Run **every validation listed in the task file** before committing. Not a subset.
- `pnpm release-check` must pass before a task is marked complete.
- If a validation fails, the task is not done. Fix it or record a blocker.
- **Never** use `--no-verify`, destructive git resets, blanket test disabling, `.skip` on a
  failing test, or any other means of making a red signal look green.

## 6. Never claim unfinished work is complete

This is the rule that matters most.

- A task is `complete` only when every acceptance criterion is met and every validation passes.
- If something does not work, say so plainly, with the failing output.
- If a step was skipped, say which and why.
- Partial work stays `in-progress` or becomes `blocked` with a precise reason.
- Do not describe a mock as an integration, a stub as an implementation, or a skipped test as
  a passing one.

## 7. Never fake an integration

- The real R2, Clerk, Neon, Liveblocks, and Trigger.dev paths must be **implemented behind
  environment configuration**. Local adapters (MinIO, `InlineDispatcher`) are for tests.
- A permanent mock standing in for a required integration is a scope reduction, and scope
  reductions are the user's decision, not an agent's.
- Never fabricate a provider response. If a service is unreachable, the system reports that
  honestly — a queued job stays queued, a status says "processing", never "complete".
- A test that is skipped because its prerequisite is absent must **skip loudly**. A silent
  pass is a lie in the build output.

## 8. Never commit

- Secrets, credentials, API keys, tokens, or connection strings. `.env.example` carries names
  and descriptions only.
- Generated uploads, local databases, or build output.
- **User music.** Ever. Audio fixtures are generated tones, kept small.
- Media fixtures larger than necessary.
- Playwright traces, coverage output, or other artifacts.

If a secret is ever committed, it is compromised. Rotate it — removing the commit is not
sufficient, because it remains in history.

### Credential-shaped values in tests

`no-secrets` runs on test files, not just source. When a test needs a credential-shaped
value, **assemble it at runtime from parts** rather than writing a literal:

```ts
const fakeKey = ['sk', 'live', 'EXAMPLENOTAREAL'].join('_');
```

Shared examples live in `packages/config/src/fixtures/credentials.ts`. This is not lint
appeasement: a realistic literal trips provider secret scanners and GitHub push protection,
a scanner cannot tell a fabricated key from a live one, and the value is in local git history
from the moment it is committed — even if the push is later rejected. That happened during
task `002`.

Public high-entropy values such as ULIDs are exempted by **shape**, not by file, so the rule
stays active everywhere.

## 9. Security is not a later task

- All authorization goes through **`packages/authz`**. Never compare roles inline in a route
  handler. A lint rule enforces this; do not work around it.
- Every tenant-owned row is workspace-scoped. Every sensitive resource class has a
  cross-workspace IDOR test.
- Unauthorized access to a tenant-scoped resource returns **404-shaped**, never 403.
- Validate with Zod at every trust boundary.
- Presigned URLs are bearer credentials: short TTL, never logged, never persisted beyond
  their lifetime.
- Never weaken a security control to make a test pass.

## 10. Stop rather than improvise

Record the blocker precisely in the task file and `tasks/STATUS.md`, then stop. Do not:

- invent or guess credentials,
- bypass a permission check to make something work,
- run an ambiguous destructive migration,
- resolve an authorization question by assumption,
- or proceed on a dirty worktree you do not understand.

Ask the user when a **credential**, a **destructive action**, a **legal or product decision**,
or a **genuinely blocking ambiguity** requires their input. Otherwise make a safe, reversible
default and record it in an ADR.

## 11. Source layout

- Application code lives in `apps/` and `packages/`. Conventional locations, always.
- `/tasks` is the plan and the state machine. It is **not** a source directory and never
  contains implementation code.
- Do not hide unplanned work in prose elsewhere. If it is work, it is a numbered task.

## 12. Product and brand invariants

These come from `docs/DESIGN.md` and are not open to reinterpretation:

- The product is **You & Friends**, always with the ampersand. Attribution is _by Avery and
  Friends_. The tagline is _Where songs live between sessions._ No other name, logo, or
  tagline is to be invented.
- Slug `youandfriends` for repository, packages, identifiers, and the `YOUANDFRIENDS_` env
  prefix.
- **Exactly one Project Files area**, organized by user-created folders and tags. Never
  separate Logic and MPC sections.
- **Originals are sacred.** Uploaded bytes are never modified or overwritten. New uploads
  create versions.
- **Private by default.** Nothing is public unless deliberately shared.
- Light mode is the primary identity; dark mode is not a mechanical inversion.
- Never claim a capability iOS does not reliably support. Document the limitation and degrade
  gracefully.

## 13. Writing code here

- TypeScript strict, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Colors come from tokens. A raw hex in a component is a lint failure.
- Accessibility is part of the acceptance criteria, not a follow-up: keyboard paths, visible
  focus, screen-reader names, and no state encoded by color alone.
- Match the surrounding code's idiom, naming, and comment density.
- Prefer the smallest change that satisfies the task. Do not widen scope opportunistically.

## 14. Available agents and skills

Agents are defined in `.claude/agents/` and skills in `.claude/skills/`. Use them:
the `task-lifecycle` skill is the standard path for claiming, validating, committing, and
closing a task; `release-check` is the standard path for verifying a change is shippable.
`/loop` is defined in `.claude/commands/loop.md`.
