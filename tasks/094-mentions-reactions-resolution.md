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

- [ ] Mention autocomplete lists only collaborators with access to the song, filtered server-side.
- [ ] Mentions are stored as structured references and survive display-name changes.
- [ ] Mentioning a user without access warns the author and grants nothing.
- [ ] Reactions work with optimistic update and rollback.
- [ ] Resolution records who and when, and unresolved threads can be filtered.
- [ ] Mention events are emitted for notifications.
- [ ] A test confirms a mention creates no access grant.

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

## Status

`pending`

## Commit

_(not yet)_
