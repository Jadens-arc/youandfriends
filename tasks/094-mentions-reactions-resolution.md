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

- [x] Mention autocomplete lists only collaborators with access to the song, filtered server-side. (`GET /api/songs/:songId/mentionable` resolves who can reach _this song_ through `loadSongCollaborators`: members, grants, and denies. It is offered only to someone who may comment there; a viewer, or anyone else, is answered 404-shaped. The fixture holds a collaborator who can reach only this song, a workspace editor denied on it, a member with access to another song only, and a stranger. Mutation-checked: widening it to the workspace fails six tests.)
- [x] Mentions are stored as structured references and survive display-name changes. (The body carries `<@USERID>`, and `comment_mentions` records whom it reached. Names are looked up when shown: renaming Sam to Samantha changes every mention of them. The text box shows `@Name`; only names picked from the list become references, and typing "@sam" by hand is just text.)
- [x] Mentioning a user without access warns the author and grants nothing. (The composer checks before sending and asks "Post anyway / Keep editing". The server's answer, `unreachedMentions`, is the last word and is shown too. The person gets no row and no notice. Readers see "@someone", never who it was.)
- [x] Reactions work with optimistic update and rollback. (A fixed set of six, stored by name. The count and pressed state change before the server answers; a refusal restores that comment's reactions and says so. Each reaction says in words what it is, the count, and who. Mutation-checked both ways.)
- [x] Resolution records who and when, and unresolved threads can be filtered. ("Resolved by Alex · 23 Sept 2026, 10:00" with a machine-readable time, plus an All / Unresolved filter. Resolving was already audited as `comment.resolved` with the actor, and a test now pins that.)
- [x] Mention events are emitted for notifications. (`comment.mentioned` with `recipientIds` goes through the same `NotificationSink` task `095` will consume. It goes only to the people newly reached, never the author; an edit tells only those it newly mentions.)
- [x] A test confirms a mention creates no access grant. (Mentioning people who cannot see the song leaves `permission_grants` and `workspace_memberships` byte-for-byte unchanged, and their resolved access still refuses `view`.)

**Where a mention leads.** The scope says a mention renders "as a link to the collaborator". Iteration one has no profile page, and the members page is owner-only, so a link there would 404 for most people. Instead, pressing a mention shows the song's threads with that person — ones they wrote in or were mentioned in — with a way back to everyone's. When a people page exists, the mention can link to it.

**In the database.** `comment_mentions` and `comment_reactions` reference the comment (composite with the workspace, cascading) and the **workspace membership** (composite, cascading). No row can name someone outside the workspace, and removing a member removes their mentions and reactions. Both are in `SCOPED_TABLES` and the IDOR registry, with seeded rows. The song-purge fixture now carries a mention and a reaction, so the purge meets both cascades.

**Not audited:** reactions. They change no work and grant nothing.

**Not verified here.** Manual QA 1–3. Notification delivery arrives with task `095`; until then the event is raised and proven by test, but nothing shows it to anyone. Real screen readers and phones are task `120`/`121`.

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

`complete`

## Commit

_(not yet)_
