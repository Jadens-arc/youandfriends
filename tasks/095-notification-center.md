# 095 — In-app notification center

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Build the in-app notification center: event generation, an unread indicator, a notification list with deep links, and read/unread management.

## User value

Knowing what happened while you were away, without checking every song.

## Scope

- `notifications` generated from the event types in `docs/DESIGN.md` §7.
- Events: version/file upload, comment/voice note, mention/reply, lyric/metadata edit, invitation/access change.
- An unread count indicator in the shell.
- A notification list with deep links to the exact comment, version, or lyric anchor.
- Mark read individually and all at once; unread filtering.
- Grouping of related notifications so ten comments on one song do not produce ten rows.
- Retention so the list stays useful.

## Non-scope

- Email delivery (task `096`), preferences (task `096`).
- Web Push (deferred `210`).
- Realtime push of notifications — polling with backoff is sufficient for iteration one.

## Dependencies

`094`, `024`

## Files expected to change

```
packages/db/src/schema/notifications.ts
apps/web/components/notifications/**
apps/web/app/api/notifications/**
packages/db/src/queries/notifications.ts
```

## Implementation notes

- Notification generation must respect authorization **at generation time and at read time**. A user who loses access to a song must not see a stale notification about it — filter on read, not only on write.
- Group aggressively. Ten comments on one song is one grouped notification, expandable. Ungrouped notification lists become noise and get ignored, which defeats the feature.
- Deep links must land precisely — on the comment, the version, the lyric anchor — not merely on the song.
- Never notify a user about their own action. It is the most common notification bug and it reads as the system being confused.
- Generate notifications from domain events rather than sprinkling `createNotification` calls through feature code, or coverage will be inconsistent.

## Security/privacy considerations

Notifications carry content previews (comment text, song titles) and must be filtered by access at read time as well as generation time — access can be revoked between the two (T1, T2). Notifications are in the task `023` IDOR suite.

## Acceptance criteria

- [x] Notifications generate for every event type in `docs/DESIGN.md` §7. (Every event in `NOTIFICATION_EVENTS` is raised by the code that causes it and appears in the list with its own wording; a test fails if an event is added without coverage.)
  - Comments: created, replied, and voice notes from the comment service; mentions from task `094`.
  - `version.created` from mix and file versions.
  - Processed and failed versions from the media worker, sent to the uploader.
  - Lyrics and metadata changes, where tasks `081`/`043` already raised them.
  - `access.changed` when a member's role changes.
  - `invitation.received` when the invited email belongs to an existing account.
- [x] An unread count appears in the shell. (A bell in the desktop header and the phone header, with the count in its accessible name. It polls every minute, backs off to 15 minutes while the server fails, pauses while the tab is hidden, and checks at once when the tab returns.)
- [x] The list deep-links to the exact comment, version, or anchor. (Comments land on `?tab=activity#comment-<id>`: the panel scrolls there once the comments load, opens a folded resolved thread, and moves focus to the comment. Mix versions go to `?version=<id>`, files to the Files tab, lyrics to the Lyrics tab, and projects to their page.)
- [x] Read/unread management works individually and in bulk. (Mark read per entry, Mark all read, All / Unread filter; opening an entry marks it read. Someone else's ids mark nothing.)
- [x] Related notifications group rather than flooding. ("Alex and Sam left 5 comments on Headlights", which expands to the list. A mention is always its own entry, and whoever is mentioned doesn't also get the generic comment notice. A reply goes to the thread's participants, not everyone on the song.)
- [x] Users are never notified of their own actions. (Excluded when generating, and refused by a `notifications_not_to_self` check.)
- [x] Notifications are filtered by access at read time, proven by a revoked-access test. (Revoking Nina's only grant hides her Headlights notification although the row remains; restoring the grant shows it again. Trashing a song hides its notifications. Mutation-checked.)
- [x] Retention keeps the list useful. (Everything goes after 90 days, read ones after 30, pruned as the list is read; the list reads at most the newest 300.)

**Content is not copied.** A row holds ids. A comment's words are read from the comment when shown, so deleting a comment takes its words out of every notification, and a mention inside it disappears entirely.

**Invitations.** Accepting still requires the invitation link (task `032`, T11). The in-app notice tells an existing account holder who invited them where, with no token and no link. It shows from whichever workspace they are in, and only while the invitation is pending, unexpired, and addressed to their email. Letting a signed-in, email-matched person accept from the notice would change the acceptance path — a security and product decision, not made here.

**Generation never fails the action.** Notifications are generated after the change commits; a failure is logged (ids and event name only) and swallowed. The comment was posted; saying otherwise would be false.

**Not verified here.** Manual QA 1–3 in a real browser (task `120`). Email delivery and per-event preferences are task `096`.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/db test
```

## Manual QA

1. Have a collaborator comment and confirm the notification arrives with a working deep link.
2. Revoke access to a song and confirm its notifications disappear from the list.
3. Generate many comments on one song and confirm grouping.

## Rollback/compatibility

Additive. Reverting loses notifications; events still write to audit.

## Status

`complete`

## Commit

`5b38876`
