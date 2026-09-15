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

| Requirement      | Notes                                                         |
| ---------------- | ------------------------------------------------------------- |
| Node.js ≥ 22     |                                                               |
| pnpm 10          | `corepack enable && corepack prepare pnpm@10.33.0 --activate` |
| Docker           | For Postgres and MinIO in tests (from task `052`)             |
| ffmpeg + ffprobe | For the media pipeline (from task `060`). Not yet required.   |
| Rust toolchain   | For the macOS sync agent (from task `111`). **macOS only.**   |

Tasks whose prerequisites are absent **skip loudly** in the test suite — they never pass
silently.

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
