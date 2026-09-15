# 000 — Repository foundation, plan, and Claude configuration

**Phase:** Foundation · **Iteration:** one

## Objective

Establish the repository: the authoritative design document, architecture and operations
documentation, the complete numbered task plan for the entire product, the Claude agent
configuration, and a monorepo scaffold that builds, lints, typechecks, and tests green.

## User value

Nothing ships to a user from this task directly. Its value is that every subsequent task has a
correct place to put code, a defined quality bar, and a plan that does not have to be
re-derived. It is the difference between a build and a pile of files.

## Scope

- `docs/DESIGN.md` from the supplied specification, with the final You & Friends brand identity.
- `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/OPERATIONS.md`.
- ADRs 0001–0007 covering the decisions with real trade-offs.
- The complete `/tasks` plan: iteration one and all deferred phases, with `STATUS.md`.
- `CLAUDE.md` enforcing the working rules.
- `.claude/agents` (9 agents), `.claude/skills` (8 skills), `.claude/commands/loop.md`,
  `.claude/settings.json`.
- Monorepo scaffold: pnpm workspaces, Turborepo, shared TypeScript/ESLint/Prettier config,
  `apps/web` Next.js skeleton, empty-but-valid `packages/*`.
- `README.md` and `.env.example`.

## Non-scope

- Any product feature. No database schema, no auth, no upload, no player.
- Tauri scaffold (task `111`) and Trigger.dev job definitions (task `064`).
- shadcn component installation and Studio Notebook tokens (tasks `010`–`012`).
- CI workflow definition (task `123`) beyond a runnable local `release-check` stub.

## Dependencies

None. This is the root task.

## Files expected to change

```
CLAUDE.md  README.md  .env.example  .gitignore  package.json  pnpm-workspace.yaml
turbo.json  .npmrc  .prettierrc.json  eslint.config.mjs  tsconfig.json
.claude/{settings.json,agents/*.md,skills/*/SKILL.md,commands/loop.md}
docs/{DESIGN,ARCHITECTURE,THREAT_MODEL,OPERATIONS}.md  docs/adr/*.md
tasks/{README,STATUS}.md  tasks/*.md
apps/web/**  packages/{config,contracts,db,authz,storage,media,ui}/**
```

## Implementation notes

- The design document is authoritative for product behavior; the build prompt is authoritative
  for engineering. Where they overlap, neither is silently overridden — differences are
  recorded in an ADR.
- Internal packages are consumed as source via `exports` pointing at `src`, with
  `transpilePackages` in Next.js. No inter-package build step during development (ADR 0007).
- The scaffold must be genuinely green, not green because nothing runs. Each package ships at
  least one real test so `pnpm test` exercises the runner.
- `packages/*` are created as valid, typechecking, empty-surface packages. Their content
  arrives in their own numbered tasks.

## Security/privacy considerations

- `.env.example` carries variable names and descriptions, **never values**.
- `.gitignore` must cover `.env*` (except `.env.example`), `node_modules`, `.next`, `.turbo`,
  build output, local databases, and upload scratch directories before the first commit.
- No credentials, no user music, no media fixtures beyond tiny generated tones.

## Acceptance criteria

- [x] `docs/DESIGN.md` exists, matches the supplied specification, and applies the You & Friends brand identity throughout.
- [x] `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/OPERATIONS.md` exist and describe the chosen stack.
- [x] ADRs exist for R2, the media-job runtime, Liveblocks/Yjs, the audio derivative format, and Mac sync authentication.
- [x] `/tasks` contains a numbered file for every task in the plan, each with all fourteen required sections.
- [x] `tasks/STATUS.md` indexes every task with number, title, phase, dependencies, status, commit, and blocker.
- [x] Iteration-one tasks are clearly distinguished from deferred tasks.
- [x] `CLAUDE.md` enforces every rule listed in the build prompt.
- [x] Nine agent definitions exist, each with purpose, scope, forbidden actions, inputs, output format, and handoff rules.
- [x] Eight skills exist, each with concrete steps, expected commands, stop conditions, and output requirements.
- [x] `.claude/commands/loop.md` implements the twelve-step loop and its stop conditions.
- [x] `pnpm install` succeeds from a clean checkout.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass.
- [x] `.gitignore` prevents committing secrets and build output.

## Tests and validation commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git status --porcelain   # must show nothing ignored-but-tracked
```

## Manual QA

1. Clone fresh into a temp directory, `pnpm install`, `pnpm dev`, confirm `apps/web` serves.
2. Read `tasks/STATUS.md` and confirm the earliest unblocked pending task is unambiguous.
3. Confirm `.env.example` contains no real values.

## Rollback/compatibility

Nothing depends on this task yet, so rollback is deleting the commit. No data, no migrations,
no deployed surface. Fully reversible.

## Status

`complete`

## Commit

_Recorded in task `001`'s commit, per the SHA protocol in `tasks/README.md`._
