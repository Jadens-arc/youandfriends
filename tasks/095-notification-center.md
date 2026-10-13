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

- [x] Notifications generate for every event type in `docs/DESIGN.md` §7.
- [x] An unread count appears in the shell.
- [x] The list deep-links to the exact comment, version, or anchor.
- [x] Read/unread management works individually and in bulk.
- [x] Related notifications group rather than flooding.
- [x] Users are never notified of their own actions.
- [x] Notifications are filtered by access at read time, proven by a revoked-access test.
- [x] Retention keeps the list useful.

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

## Implementation record

- `notifications` (migration `0024`): one row per recipient per group while unread; further
  events fold in by upsert on a partial unique index, keeping the newest five as `items`.
- Generation lives in one place, `apps/web/lib/notifications/generate.ts`, fed by the
  `NotificationSink` domain events that feature code already raised. `libraryContext` now
  carries a real notifier. Recipients are everyone who can open the target, through the
  resolver, or the addressed people (mentions), still only if they can open it. The actor is
  never notified. A failure to notify is logged and never undoes the action.
- Events wired: comment, reply, voice note, mention, mix version and file version uploads,
  lyrics and metadata edits, member role changes (to the member), and accepted invitations
  (to the inviter). The media worker tells the uploader when a version is processed or failed.
- Read path (`lib/notifications/service.ts`) re-resolves access for every row and hides trashed
  targets; the unread count runs through the same filter.
- Deep links: `?tab=activity&thread=` or `?tab=lyrics&thread=` scroll to and focus the thread
  (and unfold the resolved list when needed); versions use `?version=`.
- Shell: a bell with the unread count (polled every minute, backing off to ten minutes on
  failure) in the desktop header and the mobile header; `/notifications` is the list.
- Retention: read rows older than 30 days are removed, and at most 200 rows are kept per person
  per workspace.

**Deviation:** `invitation.received` is not delivered in-app. An invitee is not yet a member of
the workspace, so there is nowhere in-app they could read it; the invitation link is delivered by
email in task `096`.

## Review flag

Fast-tracked at the user's request (2026-10-13); no security-reviewer or test-reviewer pass. The version-upload and media-worker notifications have no dedicated tests.

## Status

`complete`

## Commit

_(not yet)_
