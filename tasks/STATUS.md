# You & Friends — Task Status

_A private music workspace by Avery and Friends._

**This is the canonical index. Read it first, before any other file.**

Protocol, status meanings, and the commit-SHA recording rule are documented in
`tasks/README.md`. A task is never marked `complete` with a failing test or an unmet
acceptance criterion.

## Summary

|                     | Count  |
| ------------------- | ------ |
| Iteration-one tasks | 82     |
| Deferred tasks      | 17     |
| **Total**           | **99** |

Current position: task `001` is `in-progress`. Task `000` is `complete` at `6f071c6`.

## Iteration one

| #     | Title                                                        | Phase                                | Depends on                                | Status        | Commit    | Blocker |
| ----- | ------------------------------------------------------------ | ------------------------------------ | ----------------------------------------- | ------------- | --------- | ------- |
| `000` | Repository foundation, plan, and Claude configuration        | Foundation                           | —                                         | `complete`    | `6f071c6` | —       |
| `001` | Tooling and quality gates                                    | Foundation                           | `000`                                     | `in-progress` | —         | —       |
| `002` | Environment configuration and observability hooks            | Foundation                           | `000`, `001`                              | `pending`     | —         | —       |
| `003` | Shared contracts and validation boundary                     | Foundation                           | `000`, `001`                              | `pending`     | —         | —       |
| `010` | Studio Notebook foundation tokens                            | Studio Notebook design system        | `000`, `001`                              | `pending`     | —         | —       |
| `011` | Typography system and font loading                           | Studio Notebook design system        | `010`                                     | `pending`     | —         | —       |
| `012` | shadcn primitives restyled into Studio Notebook              | Studio Notebook design system        | `010`, `011`                              | `pending`     | —         | —       |
| `013` | Desktop application shell                                    | Studio Notebook design system        | `012`                                     | `pending`     | —         | —       |
| `014` | Mobile application shell                                     | Studio Notebook design system        | `013`                                     | `pending`     | —         | —       |
| `015` | Isolated component showcase                                  | Studio Notebook design system        | `012`, `013`, `014`                       | `pending`     | —         | —       |
| `020` | Database package, Neon connection, migration tooling         | Data, authorization, audit           | `002`, `003`                              | `pending`     | —         | —       |
| `021` | Core schema: identity, tenancy, and content hierarchy        | Data, authorization, audit           | `020`                                     | `pending`     | —         | —       |
| `022` | Centralized authorization package                            | Data, authorization, audit           | `021`, `003`                              | `pending`     | —         | —       |
| `023` | Executable permission matrix and IDOR test suite             | Data, authorization, audit           | `022`                                     | `pending`     | —         | —       |
| `024` | Audit log                                                    | Data, authorization, audit           | `022`                                     | `pending`     | —         | —       |
| `025` | Soft deletion and recovery window                            | Data, authorization, audit           | `024`                                     | `pending`     | —         | —       |
| `026` | Assets, immutable versions, and storage objects schema       | Data, authorization, audit           | `021`, `025`                              | `pending`     | —         | —       |
| `027` | Seed and demo data                                           | Data, authorization, audit           | `026`, `024`                              | `pending`     | —         | —       |
| `030` | Clerk authentication and session handling                    | Authentication and workspace         | `022`, `012`                              | `pending`     | —         | —       |
| `031` | Workspace provisioning and settings                          | Authentication and workspace         | `030`, `021`                              | `pending`     | —         | —       |
| `032` | Memberships and invitations                                  | Authentication and workspace         | `031`, `023`, `024`                       | `pending`     | —         | —       |
| `040` | Folder tree and library navigation                           | Library navigation                   | `032`, `013`, `014`                       | `pending`     | —         | —       |
| `041` | Project library view                                         | Library navigation                   | `040`                                     | `pending`     | —         | —       |
| `042` | Song workspace and tabs                                      | Library navigation                   | `041`, `026`                              | `pending`     | —         | —       |
| `043` | Song and project metadata editing                            | Library navigation                   | `042`, `024`                              | `pending`     | —         | —       |
| `044` | Favorites, recents, and activity                             | Library navigation                   | `042`, `024`                              | `pending`     | —         | —       |
| `045` | Command palette and search                                   | Library navigation                   | `041`, `080`                              | `pending`     | —         | —       |
| `050` | Storage package and R2 driver                                | Upload, storage, versions            | `002`, `003`                              | `pending`     | —         | —       |
| `051` | Upload session API                                           | Upload, storage, versions            | `050`, `026`, `023`                       | `pending`     | —         | —       |
| `052` | Storage contract tests against MinIO                         | Upload, storage, versions            | `050`, `051`                              | `pending`     | —         | —       |
| `053` | Client multipart uploader                                    | Upload, storage, versions            | `051`                                     | `pending`     | —         | —       |
| `054` | Browser folder upload and snapshots                          | Upload, storage, versions            | `053`, `026`                              | `pending`     | —         | —       |
| `055` | Upload interface and progress                                | Upload, storage, versions            | `053`, `054`, `014`                       | `pending`     | —         | —       |
| `056` | Mix version stack and current pointer                        | Upload, storage, versions            | `051`, `026`, `042`                       | `pending`     | —         | —       |
| `057` | Project Files: folders and tags                              | Upload, storage, versions            | `054`, `056`                              | `pending`     | —         | —       |
| `060` | Media package, ffprobe validation, capability probe          | Media pipeline                       | `050`, `003`                              | `pending`     | —         | —       |
| `061` | EBU R128 loudness and true peak analysis                     | Media pipeline                       | `060`                                     | `pending`     | —         | —       |
| `062` | AAC streaming derivative                                     | Media pipeline                       | `060`, `061`                              | `pending`     | —         | —       |
| `063` | Multi-resolution waveform peak generation                    | Media pipeline                       | `060`, `062`                              | `pending`     | —         | —       |
| `064` | Trigger.dev job orchestration                                | Media pipeline                       | `060`, `061`, `062`, `063`, `051`         | `pending`     | —         | —       |
| `065` | Processing status and error surfacing                        | Media pipeline                       | `064`, `056`                              | `pending`     | —         | —       |
| `066` | Media pipeline fixture tests                                 | Media pipeline                       | `064`, `027`                              | `pending`     | —         | —       |
| `070` | Player state machine and audio element                       | Persistent player                    | `062`, `013`                              | `pending`     | —         | —       |
| `071` | Persistent player interface                                  | Persistent player                    | `070`, `012`                              | `pending`     | —         | —       |
| `072` | Waveform rendering and seeking                               | Persistent player                    | `063`, `071`                              | `pending`     | —         | —       |
| `073` | Playback queue and best-effort gapless                       | Persistent player                    | `070`, `071`                              | `pending`     | —         | —       |
| `074` | Loop regions and playback speed                              | Persistent player                    | `072`, `073`                              | `pending`     | —         | —       |
| `075` | A/B version switching                                        | Persistent player                    | `070`, `056`, `061`                       | `pending`     | —         | —       |
| `076` | Media Session and background playback                        | Persistent player                    | `070`, `073`                              | `pending`     | —         | —       |
| `077` | Mobile mini-player and expanded player                       | Persistent player                    | `071`, `072`, `074`, `075`, `014`         | `pending`     | —         | —       |
| `080` | Lyrics schema, plain-text projection, and autosave           | Collaborative lyrics                 | `026`, `042`                              | `pending`     | —         | —       |
| `081` | Tiptap structured lyrics editor                              | Collaborative lyrics                 | `080`, `011`                              | `pending`     | —         | —       |
| `082` | Real-time collaboration, presence, and cursors               | Collaborative lyrics                 | `081`, `080`, `023`                       | `pending`     | —         | —       |
| `083` | Lyric timestamp anchors                                      | Collaborative lyrics                 | `081`, `072`                              | `pending`     | —         | —       |
| `084` | Revision snapshots and restoration                           | Collaborative lyrics                 | `080`, `082`                              | `pending`     | —         | —       |
| `085` | Mobile lyrics experience                                     | Collaborative lyrics                 | `081`, `082`, `083`, `014`                | `pending`     | —         | —       |
| `090` | Comment schema, threads, and general comments                | Comments, voice notes, notifications | `042`, `026`                              | `pending`     | —         | —       |
| `091` | Timestamped audio comments                                   | Comments, voice notes, notifications | `090`, `072`, `071`                       | `pending`     | —         | —       |
| `092` | Lyric-anchored comments                                      | Comments, voice notes, notifications | `090`, `081`, `082`                       | `pending`     | —         | —       |
| `093` | Voice notes                                                  | Comments, voice notes, notifications | `090`, `053`, `063`                       | `pending`     | —         | —       |
| `094` | Mentions, reactions, and thread resolution                   | Comments, voice notes, notifications | `090`, `032`                              | `pending`     | —         | —       |
| `095` | In-app notification center                                   | Comments, voice notes, notifications | `094`, `024`                              | `pending`     | —         | —       |
| `096` | Notification preferences and email delivery                  | Comments, voice notes, notifications | `095`, `002`                              | `pending`     | —         | —       |
| `100` | PWA manifest, icons, and installability                      | Mobile and PWA                       | `014`, `010`                              | `pending`     | —         | —       |
| `101` | Responsive audit across all implemented flows                | Mobile and PWA                       | `077`, `085`, `095`, `055`                | `pending`     | —         | —       |
| `102` | Mobile playback verification and iOS limitations             | Mobile and PWA                       | `076`, `077`, `062`                       | `pending`     | —         | —       |
| `103` | Bottom sheets and mobile navigation refinement               | Mobile and PWA                       | `101`, `014`                              | `pending`     | —         | —       |
| `110` | Sync token issuance and device management                    | macOS sync agent                     | `032`, `023`, `024`                       | `pending`     | —         | —       |
| `111` | Tauri 2 menu-bar application scaffold                        | macOS sync agent                     | `001`, `110`                              | `pending`     | —         | —       |
| `112` | Recursive folder watching, debounce, and stability detection | macOS sync agent                     | `111`                                     | `pending`     | —         | —       |
| `113` | Ignore rules and deterministic manifest                      | macOS sync agent                     | `112`, `054`                              | `pending`     | —         | —       |
| `114` | Local ZIP snapshot creation                                  | macOS sync agent                     | `113`                                     | `pending`     | —         | —       |
| `115` | Resumable multipart upload from the agent                    | macOS sync agent                     | `114`, `110`, `051`                       | `pending`     | —         | —       |
| `116` | Menu-bar interface and controls                              | macOS sync agent                     | `115`, `113`                              | `pending`     | —         | —       |
| `117` | Sleep, network, and lifecycle resilience                     | macOS sync agent                     | `116`, `115`, `112`                       | `pending`     | —         | —       |
| `118` | Sync agent test suite                                        | macOS sync agent                     | `117`                                     | `pending`     | —         | —       |
| `120` | Playwright critical path tests                               | Quality, release, closeout           | `101`, `027`, `066`                       | `pending`     | —         | —       |
| `121` | Accessibility audit and remediation                          | Quality, release, closeout           | `120`, `101`                              | `pending`     | —         | —       |
| `122` | Complete release check, dependency and secret scanning       | Quality, release, closeout           | `118`, `120`, `121`                       | `pending`     | —         | —       |
| `123` | Continuous integration pipeline                              | Quality, release, closeout           | `122`                                     | `pending`     | —         | —       |
| `124` | Deployment path and runbook verification                     | Quality, release, closeout           | `123`, `122`                              | `pending`     | —         | —       |
| `125` | Iteration one closeout and verification                      | Quality, release, closeout           | `124`, and every other iteration-one task | `pending`     | —         | —       |

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

- `208`, `209` — Billing and public signup require product and legal decisions that
  are explicitly not engineering's to make alone. Both are marked in their files as needing
  user direction before work begins.
- `215` — Data export, retention, and account closure is a **launch prerequisite** per
  `docs/DESIGN.md` §13, not an optional extra.
- `125` — The iteration-one closeout is followed by a metadata-only commit, the single
  documented exception to the one-task-per-commit rule.
