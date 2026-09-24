# You & Friends — Task Status

_A private music workspace by Avery and Friends._

**This is the canonical index. Read it first, before any other file.**

> Generated from the task files by `scripts/generate-status.mjs`. Each task file owns its own
> status and commit SHA; this table is the index over them. Do not hand-edit — run
> `node scripts/generate-status.mjs` instead. `release-check` fails if this file is stale.

Protocol, status meanings, and the commit-SHA recording rule are documented in
`tasks/README.md`. A task is never marked `complete` with a failing test or an unmet
acceptance criterion.

## Summary

|                     | Count   |
| ------------------- | ------- |
| Iteration-one tasks | 95      |
| Deferred tasks      | 17      |
| **Total**           | **112** |

Task `077` is next. `016`, `029`, `045` are passed over until their dependencies are `complete`. 60 of 95 iteration-one tasks are `complete`.

## Iteration one

| #     | Title                                                                  | Phase                                | Depends on                                | Status     | Commit    | Blocker |
| ----- | ---------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------- | ---------- | --------- | ------- |
| `000` | Repository foundation, plan, and Claude configuration                  | Foundation                           | —                                         | `complete` | `6f071c6` | —       |
| `001` | Tooling and quality gates                                              | Foundation                           | `000`                                     | `complete` | `76ad7eb` | —       |
| `002` | Environment configuration and observability hooks                      | Foundation                           | `000`, `001`                              | `complete` | `4446123` | —       |
| `003` | Shared contracts and validation boundary                               | Foundation                           | `000`, `001`                              | `complete` | `35dcb65` | —       |
| `004` | Tighten the secret-detection lint exemption                            | Foundation                           | `001`, `003`                              | `complete` | `340cc69` | —       |
| `005` | Close the dependency-boundary subpath hole and test the ID brand       | Foundation                           | `003`                                     | `complete` | `af96cf4` | —       |
| `006` | Threat model the operator tooling that writes outside the request path | Foundation                           | `027`                                     | `complete` | `3ae2462` | —       |
| `007` | Make storage-object ownership a database fact                          | Foundation                           | `028`                                     | `complete` | `adaed5d` | —       |
| `010` | Studio Notebook foundation tokens                                      | Studio Notebook design system        | `000`, `001`                              | `complete` | `cb23adb` | —       |
| `011` | Typography system and font loading                                     | Studio Notebook design system        | `010`                                     | `complete` | `3b533fe` | —       |
| `012` | shadcn primitives restyled into Studio Notebook                        | Studio Notebook design system        | `010`, `011`                              | `complete` | `ec3cb5d` | —       |
| `013` | Desktop application shell                                              | Studio Notebook design system        | `012`                                     | `complete` | `0d8b593` | —       |
| `014` | Mobile application shell                                               | Studio Notebook design system        | `013`                                     | `complete` | `ea051d3` | —       |
| `015` | Isolated component showcase                                            | Studio Notebook design system        | `012`, `013`, `014`                       | `complete` | `6639d6b` | —       |
| `016` | Menu and focus coverage in a real browser                              | Studio Notebook design system        | `012`, `120`                              | `pending`  | —         | —       |
| `020` | Database package, Neon connection, migration tooling                   | Data, authorization, audit           | `002`, `003`                              | `complete` | `4020c36` | —       |
| `021` | Core schema: identity, tenancy, and content hierarchy                  | Data, authorization, audit           | `020`                                     | `complete` | `628f2c5` | —       |
| `022` | Centralized authorization package                                      | Data, authorization, audit           | `021`, `003`                              | `complete` | `50802b5` | —       |
| `023` | Executable permission matrix and IDOR test suite                       | Data, authorization, audit           | `022`                                     | `complete` | `4d00a65` | —       |
| `024` | Audit log                                                              | Data, authorization, audit           | `022`                                     | `complete` | `7ac4205` | —       |
| `025` | Soft deletion and recovery window                                      | Data, authorization, audit           | `024`                                     | `complete` | `64345dd` | —       |
| `026` | Assets, immutable versions, and storage objects schema                 | Data, authorization, audit           | `021`, `025`                              | `complete` | `4c761c4` | —       |
| `027` | Seed and demo data                                                     | Data, authorization, audit           | `026`, `024`                              | `complete` | `c37807c` | —       |
| `028` | Purge reaches storage objects, and assets join the lifecycle           | Data, authorization, audit           | `026`                                     | `complete` | `c912e4c` | —       |
| `029` | Seed lyrics, comments, and notifications                               | Data, authorization, audit           | `027`, `080`, `090`, `095`                | `pending`  | —         | —       |
| `030` | Clerk authentication and session handling                              | Authentication and workspace         | `022`, `012`                              | `complete` | `3255871` | —       |
| `031` | Workspace provisioning and settings                                    | Authentication and workspace         | `030`, `021`                              | `complete` | `1ee0672` | —       |
| `032` | Memberships and invitations                                            | Authentication and workspace         | `031`, `023`, `024`                       | `complete` | `12ab247` | —       |
| `040` | Folder tree and library navigation                                     | Library navigation                   | `032`, `013`, `014`                       | `complete` | `e884a5b` | —       |
| `041` | Project library view                                                   | Library navigation                   | `040`                                     | `complete` | `0b4de9f` | —       |
| `042` | Song workspace and tabs                                                | Library navigation                   | `041`, `026`                              | `complete` | `564a54c` | —       |
| `043` | Song and project metadata editing                                      | Library navigation                   | `042`, `024`                              | `complete` | `315d389` | —       |
| `044` | Favorites, recents, and activity                                       | Library navigation                   | `042`, `024`                              | `complete` | `1838e8c` | —       |
| `045` | Command palette and search                                             | Library navigation                   | `041`, `080`                              | `pending`  | —         | —       |
| `046` | Create projects and songs                                              | Library navigation                   | `041`, `042`, `024`                       | `complete` | `1e5bfe5` | —       |
| `050` | Storage package and R2 driver                                          | Upload, storage, versions            | `002`, `003`                              | `complete` | `683c0ca` | —       |
| `051` | Upload session API                                                     | Upload, storage, versions            | `050`, `026`, `023`                       | `complete` | `3221a64` | —       |
| `052` | Storage contract tests against MinIO                                   | Upload, storage, versions            | `050`, `051`                              | `complete` | `dae8638` | —       |
| `053` | Client multipart uploader                                              | Upload, storage, versions            | `051`, `058`                              | `complete` | `929e816` | —       |
| `054` | Browser folder upload and snapshots                                    | Upload, storage, versions            | `053`, `026`                              | `complete` | `df5d104` | —       |
| `055` | Upload interface and progress                                          | Upload, storage, versions            | `053`, `054`, `014`, `046`                | `complete` | `5376b3c` | —       |
| `056` | Mix version stack and current pointer                                  | Upload, storage, versions            | `051`, `026`, `042`                       | `complete` | `f9d642e` | —       |
| `057` | Project Files: folders and tags                                        | Upload, storage, versions            | `054`, `056`                              | `complete` | `cdbfa26` | —       |
| `058` | Upload HTTP endpoints                                                  | Upload, storage, versions            | `051`, `031`, `030`                       | `complete` | `06862fa` | —       |
| `059` | Typecheck the operational scripts                                      | Data, authorization, audit           | `051`                                     | `complete` | `70db6f6` | —       |
| `060` | Media package, ffprobe validation, capability probe                    | Media pipeline                       | `050`, `003`                              | `complete` | `d783b17` | —       |
| `061` | EBU R128 loudness and true peak analysis                               | Media pipeline                       | `060`                                     | `complete` | `3e3d092` | —       |
| `062` | AAC streaming derivative                                               | Media pipeline                       | `060`, `061`                              | `complete` | `d4c37c7` | —       |
| `063` | Multi-resolution waveform peak generation                              | Media pipeline                       | `060`, `062`                              | `complete` | `bdabdaf` | —       |
| `064` | Trigger.dev job orchestration                                          | Media pipeline                       | `060`, `061`, `062`, `063`, `051`         | `complete` | `1747ccb` | —       |
| `065` | Processing status and error surfacing                                  | Media pipeline                       | `064`, `056`                              | `complete` | `5f26333` | —       |
| `066` | Media pipeline fixture tests                                           | Media pipeline                       | `064`, `027`                              | `complete` | `24b9a4d` | —       |
| `067` | Serve stored bytes as the type we recorded                             | Media pipeline                       | `051`, `062`                              | `complete` | `2c19915` | —       |
| `068` | Threat model the media pipeline                                        | Media pipeline                       | `060`                                     | `complete` | `1562f13` | —       |
| `069` | Cover art renditions and delivery                                      | Media pipeline                       | `064`, `067`, `058`                       | `complete` | `bb44d54` | —       |
| `070` | Player state machine and audio element                                 | Persistent player                    | `062`, `013`, `067`                       | `complete` | `607486d` | —       |
| `071` | Persistent player interface                                            | Persistent player                    | `070`, `012`                              | `complete` | `6132517` | —       |
| `072` | Waveform rendering and seeking                                         | Persistent player                    | `063`, `071`                              | `complete` | `128f15d` | —       |
| `073` | Playback queue and best-effort gapless                                 | Persistent player                    | `070`, `071`                              | `complete` | `8e74a44` | —       |
| `074` | Loop regions and playback speed                                        | Persistent player                    | `072`, `073`                              | `complete` | `5ad612f` | —       |
| `075` | A/B version switching                                                  | Persistent player                    | `070`, `056`, `061`                       | `complete` | `41af46e` | —       |
| `076` | Media Session and background playback                                  | Persistent player                    | `070`, `073`                              | `complete` | —         | —       |
| `077` | Mobile mini-player and expanded player                                 | Persistent player                    | `071`, `072`, `074`, `075`, `014`         | `pending`  | —         | —       |
| `080` | Lyrics schema, plain-text projection, and autosave                     | Collaborative lyrics                 | `026`, `042`                              | `pending`  | —         | —       |
| `081` | Tiptap structured lyrics editor                                        | Collaborative lyrics                 | `080`, `011`                              | `pending`  | —         | —       |
| `082` | Real-time collaboration, presence, and cursors                         | Collaborative lyrics                 | `081`, `080`, `023`                       | `pending`  | —         | —       |
| `083` | Lyric timestamp anchors                                                | Collaborative lyrics                 | `081`, `072`                              | `pending`  | —         | —       |
| `084` | Revision snapshots and restoration                                     | Collaborative lyrics                 | `080`, `082`                              | `pending`  | —         | —       |
| `085` | Mobile lyrics experience                                               | Collaborative lyrics                 | `081`, `082`, `083`, `014`                | `pending`  | —         | —       |
| `090` | Comment schema, threads, and general comments                          | Comments, voice notes, notifications | `042`, `026`                              | `pending`  | —         | —       |
| `091` | Timestamped audio comments                                             | Comments, voice notes, notifications | `090`, `072`, `071`                       | `pending`  | —         | —       |
| `092` | Lyric-anchored comments                                                | Comments, voice notes, notifications | `090`, `081`, `082`                       | `pending`  | —         | —       |
| `093` | Voice notes                                                            | Comments, voice notes, notifications | `090`, `053`, `063`                       | `pending`  | —         | —       |
| `094` | Mentions, reactions, and thread resolution                             | Comments, voice notes, notifications | `090`, `032`                              | `pending`  | —         | —       |
| `095` | In-app notification center                                             | Comments, voice notes, notifications | `094`, `024`                              | `pending`  | —         | —       |
| `096` | Notification preferences and email delivery                            | Comments, voice notes, notifications | `095`, `002`                              | `pending`  | —         | —       |
| `100` | PWA manifest, icons, and installability                                | Mobile and PWA                       | `014`, `010`                              | `complete` | `3a628af` | —       |
| `101` | Responsive audit across all implemented flows                          | Mobile and PWA                       | `077`, `085`, `095`, `055`                | `pending`  | —         | —       |
| `102` | Mobile playback verification and iOS limitations                       | Mobile and PWA                       | `076`, `077`, `062`                       | `pending`  | —         | —       |
| `103` | Bottom sheets and mobile navigation refinement                         | Mobile and PWA                       | `101`, `014`                              | `pending`  | —         | —       |
| `110` | Sync token issuance and device management                              | macOS sync agent                     | `032`, `023`, `024`                       | `pending`  | —         | —       |
| `111` | Tauri 2 menu-bar application scaffold                                  | macOS sync agent                     | `001`, `110`                              | `pending`  | —         | —       |
| `112` | Recursive folder watching, debounce, and stability detection           | macOS sync agent                     | `111`                                     | `pending`  | —         | —       |
| `113` | Ignore rules and deterministic manifest                                | macOS sync agent                     | `112`, `054`                              | `pending`  | —         | —       |
| `114` | Local ZIP snapshot creation                                            | macOS sync agent                     | `113`                                     | `pending`  | —         | —       |
| `115` | Resumable multipart upload from the agent                              | macOS sync agent                     | `114`, `110`, `051`                       | `pending`  | —         | —       |
| `116` | Menu-bar interface and controls                                        | macOS sync agent                     | `115`, `113`                              | `pending`  | —         | —       |
| `117` | Sleep, network, and lifecycle resilience                               | macOS sync agent                     | `116`, `115`, `112`                       | `pending`  | —         | —       |
| `118` | Sync agent test suite                                                  | macOS sync agent                     | `117`                                     | `pending`  | —         | —       |
| `120` | Playwright critical path tests                                         | Quality, release, closeout           | `101`, `027`, `066`                       | `pending`  | —         | —       |
| `121` | Accessibility audit and remediation                                    | Quality, release, closeout           | `120`, `101`                              | `pending`  | —         | —       |
| `122` | Complete release check, dependency and secret scanning                 | Quality, release, closeout           | `118`, `120`, `121`                       | `pending`  | —         | —       |
| `123` | Continuous integration pipeline                                        | Quality, release, closeout           | `122`                                     | `pending`  | —         | —       |
| `124` | Deployment path and runbook verification                               | Quality, release, closeout           | `123`, `122`                              | `pending`  | —         | —       |
| `125` | Iteration one closeout and verification                                | Quality, release, closeout           | `124`, and every other iteration-one task | `pending`  | —         | —       |

## Deferred — planned, numbered, and out of iteration-one scope

These are not omissions. Each is a real task with dependencies, to be scheduled after the
iteration-one milestone.

| #     | Title                                                  | Phase              | Depends on          | Status    | Commit | Blocker |
| ----- | ------------------------------------------------------ | ------------------ | ------------------- | --------- | ------ | ------- |
| `200` | External share links — core                            | External sharing   | `023`, `056`        | `pending` | —      | —       |
| `201` | Share links — passwords and expiry                     | External sharing   | `200`               | `pending` | —      | —       |
| `202` | Share links — rate limiting and enumeration resistance | External sharing   | `201`               | `pending` | —      | —       |
| `203` | Offline audio downloads in the PWA                     | Offline            | `100`, `070`        | `pending` | —      | —       |
| `204` | Offline queued lyric edits and comments                | Offline            | `203`, `082`, `090` | `pending` | —      | —       |
| `205` | Opus streaming derivative for capable clients          | Media enhancements | `062`, `102`        | `pending` | —      | —       |
| `206` | HLS adaptive streaming                                 | Media enhancements | `205`               | `pending` | —      | —       |
| `207` | Administration console                                 | Administration     | `024`, `064`, `025` | `pending` | —      | —       |
| `208` | Billing and subscription management                    | Administration     | `207`, `031`        | `pending` | —      | —       |
| `209` | Public signup and onboarding                           | Administration     | `208`, `032`        | `pending` | —      | —       |
| `210` | Web Push notifications                                 | Platform           | `100`, `096`        | `pending` | —      | —       |
| `211` | Dark mode                                              | Platform           | `010`               | `pending` | —      | —       |
| `212` | Trash and recovery interface                           | Platform           | `025`               | `pending` | —      | —       |
| `213` | OAuth device authorization for the sync agent          | Platform           | `110`, `116`        | `pending` | —      | —       |
| `214` | Native iOS application                                 | Platform           | `210`, `203`        | `pending` | —      | —       |
| `215` | Data export, retention, and account closure            | Platform           | `207`, `025`        | `pending` | —      | —       |
| `216` | Postgres row-level security as defense in depth        | Platform           | `023`               | `pending` | —      | —       |

## Notes on specific tasks

- `208`, `209` — Billing and public signup require product and legal decisions that are
  explicitly not engineering's to make alone. Both are marked in their files as needing user
  direction before work begins.
- `215` — Data export, retention, and account closure is a **launch prerequisite** per
  `docs/DESIGN.md` §13, not an optional extra.
- `125` — The iteration-one closeout is followed by a metadata-only commit, the single
  documented exception to the one-task-per-commit rule.
- `004`, `005` — Added after task `003`'s review surfaced two gaps in controls written
  during `001` and `003`. Recorded rather than folded silently into an unrelated task.
- `058` — Split out of `051` before coding. The upload protocol does not need HTTP to be
  correct, but a route needs to resolve a workspace from a request, and that is `031`, which is
  `pending`. `051` delivers the tested protocol; `058` puts transport in front of it.
  `053` depends on both.
- `050`, `051` — Both landed **without a live run against an object store**: no byte has yet
  moved through the storage path. Their logic is tested against a stub driver that can be made to
  answer wrongly on purpose, which a real bucket cannot, but that is not the same evidence.
  `052` (MinIO contract tests) is where the real path is exercised and should run before
  anything else is built on top of them.
