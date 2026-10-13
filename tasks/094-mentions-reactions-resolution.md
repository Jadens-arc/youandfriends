# 094 — Mentions, reactions, and thread resolution

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Complete the discussion surface: @-mentions with autocomplete, emoji reactions, and refined resolution behavior.

## User value

Pulling the right person into a thread, and agreeing something is settled without writing another paragraph.

## Scope

- @-mention autocomplete over collaborators with access to the song.
- Mention storage as structured references, not raw text, so renames do not break them.
- Mention rendering as a link to the collaborator.
- Emoji reactions on comments with counts and reactor lists.
- Resolution refinements: who resolved, when, and a filter for unresolved threads.
- Mention events feeding notifications (task `095`).

## Non-scope

- Mentioning people without workspace access — a mention must never be an invitation vector.
- Custom emoji.
- Rich reaction analytics.

## Dependencies

`090`, `032`

## Files expected to change

```
packages/db/src/schema/comments.ts
apps/web/components/comments/mentions/**
apps/web/components/comments/reactions/**
apps/web/components/comments/__tests__/mentions.test.tsx
```

## Implementation notes

- The mention autocomplete must only list collaborators **with access to this song**. Listing the whole workspace leaks membership and access structure (threat model asset 3) to someone who may only have song-level access.
- Store mentions as structured references to user ids, not as raw `@name` text, so a display-name change does not orphan the mention.
- Mentioning someone must not grant them access. If a mentioned user cannot see the song, the mention should warn the author rather than silently notifying someone who will get a 404.
- Reactions are cheap interactions and should feel instant — optimistic update with rollback.
- Recording who resolved a thread and when matters for accountability and is audited.

## Security/privacy considerations

The mention autocomplete is a membership-disclosure surface (asset 3). It must be filtered to users with access to the specific song, server-side. A mention never grants access (T2) — this is explicitly tested.

## Acceptance criteria

- [x] Mention autocomplete lists only collaborators with access to the song, filtered server-side.
- [x] Mentions are stored as structured references and survive display-name changes.
- [x] Mentioning a user without access warns the author and grants nothing.
- [x] Reactions work with optimistic update and rollback.
- [x] Resolution records who and when, and unresolved threads can be filtered.
- [x] Mention events are emitted for notifications.
- [x] A test confirms a mention creates no access grant.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Mention a collaborator with song access and confirm they are notified.
2. Open the autocomplete as a narrowly scoped collaborator and confirm it lists only permitted users.
3. React to a comment and confirm the count updates instantly.

## Rollback/compatibility

Additive. Reverting loses mentions and reactions; comments remain.

## Implementation record

- `comment_mentions` and `comment_reactions` (migration `0023`), each composite with its comment
  and cascading. Reactions are a fixed set of six emoji, checked in the database.
- Mentions are `<@userId>` tokens in the stored words, indexed in `comment_mentions`. The composer
  shows `@Name` and converts picked names on submit; a hand-typed `@Name` mentions nobody.
- `GET /api/songs/:songId/mentionable` lists the people who can open the song, via
  `loadSongCollaborators` (commenters only, oneself excluded). A mention of anyone else is
  refused as `validation_failed` with a message telling the author it does not share the song.
- `comment.mentioned` is raised through the `NotificationSink`, which gained `recipientIds`.
  Edits notify only people newly mentioned.
- `PUT …/comments/:commentId/reactions` is idempotent both ways; the client changes its copy
  first and rolls back on refusal. Reactions are not audited (a tap, not a statement).
- Resolution already recorded who and when (task `090`); the thread now shows the time, and the
  panel has an "unresolved only" filter.
- Deleting a comment removes its mentions and reactions with its words.

**Deviation:** a mention renders as the person's name in the accent color, not a link. There is
no per-person page a collaborator could open (`/settings/members` is not for every role).

## Review flag

Fast-tracked at the user's request (2026-10-13); no security-reviewer or test-reviewer pass. Look at the mention autocomplete's disclosure (asset 3) and the mention-render deviation.

## Status

`complete`

## Commit

`523f296`
