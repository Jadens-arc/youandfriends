# You & Friends — Product and Design Specification

> **You & Friends** — a private music workspace by Avery and Friends.
> _Where songs live between sessions._
> Primary domain: `youandfriends.org`

This document is the authoritative product and visual design specification. Where the
engineering build prompt is less specific, this document wins. Engineering execution
details live in `docs/ARCHITECTURE.md` and the numbered plan in `/tasks`.

**Brand rules.** The product is always written **You & Friends**, with the ampersand —
never "You and Friends", "YouAndFriends", or an abbreviation. Attribution is _by Avery
and Friends_. The slug `youandfriends` is used for repository names, package names,
identifiers, and environment-variable prefixes. Do not invent an alternative product
name, logo, or tagline.

## 1. Product definition

A private, invitation-based workspace where musicians keep the complete life of a song:
masters, mix versions, stems, samples, general project files, lyrics, artwork, metadata,
comments, and voice notes. It combines the calm organization of Untitled with the working
depth of a production archive.

The product is not a generic cloud drive and is not a DAW. It is the connective layer
between sessions: a beautiful place to review, organize, write, discuss, share, and
retrieve musical work from Mac and iPhone.

### First audience

- Workspace owners and invited collaborators.
- Owners grant access at folder, project, or song level.
- Roles: viewer, commenter, and editor.
- External recipients may receive protected links without creating accounts.

### Product principles

1. **A song is the center.** Files, lyrics, versions, discussion, and metadata remain in context.
2. **Originals are sacred.** Preserve uploaded bytes; derivatives are disposable and reproducible.
3. **Listening never breaks.** Playback persists through navigation and queues are gapless where the browser permits.
4. **Private by default.** Nothing is public unless deliberately shared.
5. **Mobile is a working surface.** The iPhone experience supports listening, lyrics, comments, uploads, sharing, and offline audio—not merely browsing.
6. **Warm, not clinical.** The interface should feel like a beloved studio notebook without becoming skeuomorphic.

## 2. Information architecture

```text
Workspace
├── Folders (nestable)
│   └── Projects
│       └── Songs
│           ├── Mix versions
│           ├── Masters
│           ├── Stems and samples
│           ├── Project Files
│           ├── Artwork
│           ├── Lyrics
│           ├── Metadata
│           └── Comments and voice notes
└── Shared / Recent / Favorites / Trash
```

Projects have a name, artist, cover art, collaborators, status, and songs. Folders organize
projects and may be nested. A song can have many mix versions; the latest upload becomes
current automatically while all earlier versions remain available.

There is exactly one **Project Files** area. Logic projects, MPC projects, ZIP archives,
MIDI, presets, session notes, and miscellaneous production files all live there. Users may
organize these with nested folders and tags. Do not hard-code separate Logic and MPC
sections.

## 3. Permissions

Permissions may be granted at folder, project, or song level and inherit downward. A child
object may override inherited access. The effective permission is the most specific active
grant; explicit revocation wins over broader inheritance.

| Role      | Abilities                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Viewer    | Browse permitted content, stream audio, view lyrics/metadata; download only when separately allowed                          |
| Commenter | Viewer abilities plus written timestamp comments, replies, reactions, and voice notes                                        |
| Editor    | Commenter abilities plus upload files/versions, edit lyrics and metadata, organize content, and manage permitted share links |
| Owner     | Full workspace administration, billing, deletion/recovery, audit access, and permission management                           |

Inviting other users is a distinct capability that owners can delegate. Download permission
is independent of role.

## 4. Core desktop experience

### App shell

- Espresso navigation rail on the far left.
- Main content on a warm cream paper canvas.
- Persistent player fixed to the bottom; playback survives route changes.
- Desktop project view uses a split layout: song list on the left and selected-song details on the right.
- Command/search entry is always available.

### Library

- Project cards prioritize cover art, name, artist, song count, collaborators, and last activity.
- Nested folder tree remains visible on wide screens.
- Recent songs, shared work, favorites, trash, collaborator activity, and storage usage are secondary modules.
- Grid/list switch and sorting are available without overwhelming the default view.

### Song workspace

- Header: cover art, title, artist, project, duration, status, collaborators, favorite, share, and overflow actions.
- Tabs: Overview, Lyrics, Files, Comments/Activity.
- A large waveform anchors listening and timestamp-based work.
- Version selector makes the current version obvious and allows instant A/B selection.
- Files are grouped as Masters, Stems & Samples, Project Files, and Artwork. Project Files permits user-created subfolders.

### Version behavior

- Uploading a new mix creates an immutable version record and automatically marks it current.
- Original bytes are never overwritten.
- Versions display upload time, uploader, optional note, duration, format, sample rate, bit depth, loudness, and processing status.
- A/B comparison preserves playhead position when switching.

## 5. Persistent player

Required capabilities:

- Queue management and gapless transition when technically possible.
- Background playback and Media Session integration.
- AirPlay via native browser media controls where supported.
- Large waveform on song views and compact progress UI elsewhere.
- Timestamp-comment action from the current playhead.
- A/B switching between mix versions at the same playhead.
- Playback speed and loop controls; loop may use an in/out range.
- Offline download state on mobile.

The system streams optimized derivatives but always offers authorized users the untouched
lossless original for download.

## 6. Lyrics

Lyrics are a first-class collaborative document.

- Clean, autosaving editor with structured blocks such as Verse, Pre-Chorus, Chorus, Bridge, Outro, and freeform sections.
- Side-by-side waveform/audio and lyrics on desktop.
- Full-screen editor with compact waveform on mobile.
- Optional timestamps on sections or individual lines.
- Presence indicators and conflict-safe real-time editing.
- Comments may attach to a lyric selection, block, line, or timestamp.
- Revision history stores named and automatic snapshots and supports restoration.
- Clear saved/syncing/offline/conflict states.

Typography should make long writing sessions comfortable. Lyrics use a restrained monospaced
or typewriter-inspired face; headings and titles use an editorial serif; interface controls
use a highly legible sans serif.

## 7. Comments, voice notes, and notifications

- Comments can be general, timestamped to audio, or anchored to lyrics.
- Threads support replies, reactions, mentions, editing, and resolution.
- Voice notes are recorded in-browser/mobile, uploaded as private audio, and displayed with a compact waveform and duration.
- Each user configures notifications by event and channel.
- Supported events include upload/version created, comment/voice note, mention/reply, lyrics/metadata changes, and access/invitation changes.
- In-app notifications are required; email is configurable. Push is a later native/PWA enhancement unless the implementation can support it cleanly.

## 8. Sharing

Authenticated collaboration uses Clerk accounts. External sharing uses private opaque links
that may target a folder, project, or song.

Share-link controls:

- Stream-only or download-enabled.
- Optional password.
- Optional expiration.
- Immediate revocation.
- Optional per-link name for auditability.
- Access event logging without exposing unnecessary recipient data.

Never expose direct permanent object-storage URLs. Use short-lived signed URLs after an
authorization check.

## 9. Upload, storage, and media processing

### Expected scale

- Single object: up to 2 GB.
- Initial library: up to 100 GB.
- Originals include WAV/AIFF/FLAC/MP3/M4A, images, ZIPs, Logic packages/folders, MPC folders, MIDI, documents, and arbitrary project files.

### Upload paths

1. Direct file upload.
2. Browser folder upload using `webkitdirectory`, preserving relative paths.
3. Optional browser-side ZIP creation for modest folders.
4. macOS watched-folder sync agent for reliable recurring project snapshots.

Use direct-to-object-storage multipart upload with resumability, progress, cancellation,
retry, checksum validation, and an idempotent finalize call. Large file bytes must not pass
through Vercel functions.

### Folder snapshots

For a browser folder or Mac watched folder, create a manifest containing relative paths,
byte sizes, modification times, checksums, and ignored files. A snapshot becomes immutable
once finalized. The Mac agent should ZIP a stable snapshot locally, upload it, and create a
new Project Files version only after the folder has been quiet for a configurable debounce
period. Provide Pause and Sync Now controls.

Ignore transient and unsafe files by default: `.DS_Store`, hidden cache files, lock files,
incomplete renders, and user-configured patterns. Never delete local source files.

### Derived media

After audio upload, an asynchronous job should:

- Validate the media and extract duration, codec, channels, sample rate, and bit depth.
- Measure integrated loudness and true peak.
- Produce a fast streaming derivative (AAC or Opus) without modifying the original.
- Generate waveform peak data at multiple resolutions.
- Mark processing status and surface recoverable errors.

Processing must be idempotent and retry-safe.

## 10. Mobile and responsive behavior

The first implementation is an installable responsive PWA optimized for iPhone. The Mac sync
agent is separate.

- Desktop split panes collapse into navigable full-screen views.
- Secondary details and comment threads use bottom sheets.
- Mini-player remains above bottom navigation; expanded player owns the screen.
- Touch targets are at least 44×44 points.
- Offline mode permits explicitly downloaded streaming copies and queued local lyric edits/comments.
- Clearly show online, syncing, downloaded, failed, and offline states.
- Never pretend that a web PWA can provide capabilities iOS does not reliably support; document limitations and degrade gracefully.

## 11. Visual system: Studio Notebook

### Character

Warm, tactile, editorial, quiet, and intimate. It should resemble a carefully designed studio
notebook laid beside an analog console—not a beige productivity template.

### Foundation tokens

Exact production colors should be tuned during implementation while preserving these
relationships:

| Token             | Direction                                 |
| ----------------- | ----------------------------------------- |
| Canvas            | Warm cream, approximately `#F3EEE3`       |
| Raised paper      | Lighter cream, approximately `#F8F4EA`    |
| Navigation/player | Deep espresso, approximately `#2A1F18`    |
| Primary text      | Ink brown-black, approximately `#241C17`  |
| Secondary text    | Warm gray-brown, approximately `#746A60`  |
| Olive accent      | Muted sage/olive, approximately `#899078` |
| Rust accent       | Soft terracotta, approximately `#C98267`  |
| Ochre accent      | Desaturated gold, approximately `#B6A268` |
| Border            | Ink at roughly 10–14% opacity             |

- Use CSS variables and shadcn semantic tokens; never scatter raw colors across components.
- Light mode is the primary identity. A dark mode may be planned later; do not mechanically invert the design.
- Texture is a subtle CSS/noise overlay at very low opacity and must not impair readability or performance.

### Typography

- Editorial serif for project/song titles and major headings.
- Neutral sans serif for controls, navigation, metadata, and dense lists.
- Restrained monospace/typewriter face for lyrics and timestamps.
- Use locally hosted or privacy-respecting fonts and avoid layout shift.

### Shape and elevation

- Corners: mostly 8–14 px; avoid pill-shaped everything.
- Fine warm borders, restrained shadows, and paper layering.
- Dark controls may use soft inset highlights.
- Artwork is square with modest rounding and never overlaid with excessive text.

### Motion

- 150–220 ms for navigation and controls.
- Bottom sheets use a gentle spring.
- Waveform/playhead motion is linear and precise.
- Respect `prefers-reduced-motion`.

## 12. Accessibility

- WCAG 2.2 AA contrast and keyboard operation.
- Visible, tasteful focus rings.
- Semantic buttons/inputs and useful screen-reader names.
- Do not encode version or upload state by color alone.
- Waveform interactions have keyboard and textual alternatives.
- Lyrics collaboration announces presence without overwhelming assistive technology.

## 13. Trust and data policy

- Private by default.
- Encryption in transit and storage-provider encryption at rest.
- No training of AI models on uploaded music, lyrics, metadata, or behavior.
- Audit log for authentication, access, sharing, permission changes, uploads, edits, downloads, deletion, restoration, and administrative actions.
- Soft deletion and a recovery window.
- Immutable file versions and restorable lyric revisions.
- Document retention, deletion, export, and account-closure behavior before public launch.

## 14. Iteration-one definition of done

`/loop` iteration one is complete only when these work end-to-end:

1. Clerk authentication and a private workspace.
2. Folder → project → song library navigation.
3. Direct file and browser folder uploads up to the configured limit.
4. Original storage, asynchronous audio processing, waveform display, and streaming playback.
5. Current mix plus immutable version stack.
6. Persistent queue player with loop, speed, A/B switching, and timestamp positioning.
7. Structured lyrics editor with autosave, real-time collaboration, presence, and revision snapshots.
8. Written timestamp comments, voice notes, and in-app notification preferences.
9. macOS watched-folder agent that creates safe uploaded snapshots.
10. Responsive iPhone experience for the implemented flows.
11. Permissions sufficient for private owner-plus-collaborator testing.
12. Tests, seed/demo data, operational documentation, and a clean deployment path.

Advanced external share links, complete offline behavior, elaborate administration, billing,
public signup, native push, and later product features remain fully planned as numbered
deferred tasks rather than being silently omitted.

## 15. Non-goals for iteration one

- Editing multitrack audio like a DAW.
- Reconstructing Logic or MPC folders server-side.
- Automatic distribution to streaming services.
- Public social profiles or discovery feeds.
- AI-generated music or lyric generation.
- Native iOS application.
- A multi-tenant commercial billing system.

## 16. Brand application

| Surface        | Rule                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Product name   | **You & Friends**, always with the ampersand                                                     |
| Attribution    | by Avery and Friends                                                                             |
| Tagline        | Where songs live between sessions.                                                               |
| Domain         | `youandfriends.org`                                                                              |
| Package scope  | `@youandfriends/*`                                                                               |
| Env prefix     | `YOUANDFRIENDS_` for product-specific variables; provider SDKs keep their own conventional names |
| Repo slug      | `youandfriends`                                                                                  |
| Document title | `You & Friends` (escape the ampersand as `&amp;` in HTML contexts)                               |

The wordmark is typeset in the editorial serif, with the ampersand permitted in an italic
optical variant. No separate logo mark is to be invented. The tagline appears on the sign-in
screen and marketing surfaces only — never as interface chrome inside the workspace.
