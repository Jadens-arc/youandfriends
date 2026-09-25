# You & Friends

**A private music workspace by Avery and Friends.**
_Where songs live between sessions._ — [youandfriends.org](https://youandfriends.org)

A private, invitation-based workspace where musicians keep the complete life of a song:
masters, mix versions, stems, samples, project files, lyrics, artwork, metadata, comments, and
voice notes. Not a cloud drive, not a DAW — the connective layer between sessions.

## Status

Early construction. The product is built task by task against a complete numbered plan.

**[`tasks/STATUS.md`](tasks/STATUS.md) is the canonical index** — 82 iteration-one tasks and
17 deferred, each with acceptance criteria, validation commands, and a recorded status.

What exists today is the repository foundation: documentation, the full plan, the agent
configuration, and a monorepo scaffold that builds green. Product features begin at task `010`.

## Documentation

| Document                                       | What it covers                                                |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [`docs/DESIGN.md`](docs/DESIGN.md)             | **Authoritative** product and visual specification            |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System structure, data model, dependency direction            |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Assets, trust boundaries, threats, and controls               |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md)     | Deployment, runbooks, backup, key rotation, iOS limits        |
| [`docs/adr/`](docs/adr/)                       | Decisions with real trade-offs, and why they went that way    |
| [`CLAUDE.md`](CLAUDE.md)                       | Binding operating rules for agents working in this repository |

## Stack

Next.js (App Router) on Vercel · Clerk · Neon Postgres with Drizzle · Cloudflare R2 ·
Trigger.dev with ffmpeg · Tiptap + Yjs over Liveblocks · Tauri 2 for the macOS sync agent ·
Tailwind and shadcn/ui restyled into the Studio Notebook system.

Rationale for each significant choice is in [`docs/adr/`](docs/adr/).

## Prerequisites

| Requirement      | Notes                                                          |
| ---------------- | -------------------------------------------------------------- |
| Node.js ≥ 22     |                                                                |
| pnpm 10          | `corepack enable && corepack prepare pnpm@10.33.0 --activate`  |
| Docker           | For Postgres and MinIO in tests (from task `052`)              |
| ffmpeg + ffprobe | Required by `@youandfriends/media` from task `060`. See below. |
| Rust toolchain   | For the macOS sync agent (from task `111`). **macOS only.**    |
| A Clerk app      | For signing in (from task `030`). Setup below.                 |

Tasks whose prerequisites are absent **skip loudly** in the test suite — they never pass
silently.

> **ffmpeg 6.1 or later** — `apt install ffmpeg`, `brew install ffmpeg`, or the image's own
> package. Older builds, and unversioned git snapshots, are refused at startup: the version is part
> of the media threat model (`docs/THREAT_MODEL.md` T12). Any build of a recent version is not
> enough either: the pipeline needs the `aac` and `libopus` encoders and the `ebur128` filter, and
> a build missing one runs every command successfully while producing a derivative that is silent
> or empty. `assertCapabilities()` from `@youandfriends/media` checks this at worker startup and
> refuses to start otherwise (ADR 0002, ADR 0004). Check yours with:
>
> ```bash
> ffmpeg -version | head -1
> ffmpeg -hide_banner -encoders | grep -E ' (aac|libopus) '
> ffmpeg -hide_banner -filters  | grep ' ebur128 '
> ```
>
> Set `YOUANDFRIENDS_FFMPEG_PATH` / `YOUANDFRIENDS_FFPROBE_PATH` if the binaries are not on `PATH`.

> **`NODE_ENV`** — `next build` must run with `NODE_ENV=production`. The build scripts set it
> explicitly, because an inherited `NODE_ENV=development` makes prerendering fail with a
> misleading React error. See ADR 0007.

## Getting started

```bash
pnpm install
cp .env.example .env.local     # then fill in real values
pnpm dev
```

`.env.example` documents every variable, what it is for, and where to obtain it. It contains
no values and never will.

### Clerk

Signing in needs a Clerk application. Nothing in the app can authenticate without one, and the
tests that do not need a session run regardless — so a missing key is a sign-in that fails, not
a build that fails.

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Copy **Publishable key** and **Secret key** from **API Keys** into `.env.local`:

   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
   CLERK_SECRET_KEY=...
   ```

3. Set the same two in the Vercel project's environment variables, or previews cannot sign in.
4. **Turn off public sign-up** in Clerk under **User & Authentication → Restrictions**.
   Iteration one is invitation-only (task `030` non-scope; public sign-up is deferred `209`).
   The `/sign-up` route exists to complete an invitation — the route being reachable is not the
   same as sign-up being open, and Clerk is what enforces the difference.

The secret key is a server secret: it is covered by the redaction list from task `002`, and it
belongs in `.env.local` and Vercel, never in a commit (`CLAUDE.md` §8).

## Quality gates

```bash
pnpm release-check          # every registered gate, fast to slow
pnpm release-check --list   # what runs, and what is not yet registered
```

Individually: `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`

The check reports which gates ran, which skipped and why, and which are not yet registered —
so a green result means what it says.

## Repository shape

```text
apps/web          the product
apps/jobs         Trigger.dev media tasks          (task 064)
apps/sync-mac     Tauri 2 macOS sync agent         (task 111)
packages/config   env parsing, logging, tsconfig, tailwind preset
packages/contracts Zod schemas at every trust boundary
packages/db       Drizzle schema and migrations
packages/authz    the single source of permission truth
packages/storage  StorageDriver interface, R2 implementation
packages/media    ffprobe, loudness, derivatives, waveform peaks
packages/ui       the Studio Notebook design system
docs/             specification, architecture, threat model, operations, ADRs
tasks/            the complete plan and execution state
```

`tasks/` is the plan and the state machine — never a source directory.

## How work proceeds

One task, one commit. Commit messages begin with the task number (`012: add multipart upload
finalization`). A task is complete only when every acceptance criterion is met and every
validation passes. The protocol, including how commit SHAs are recorded, is in
[`tasks/README.md`](tasks/README.md).

## Privacy

Private by default. Encryption in transit and at rest. **No AI models are trained on uploaded
music, lyrics, metadata, or behavior.** Full commitments in [`docs/DESIGN.md`](docs/DESIGN.md)
§13.
