# 090 — Comment schema, threads, and general comments

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Build the commenting foundation: threads with anchors, replies, editing, deletion, and resolution, starting with general song-level comments.

## User value

The conversation about a song, kept with the song instead of scattered across text messages.

## Scope

- `comment_threads` with an anchor discriminator: general, audio timestamp, or lyric range.
- `comments` with author, body, created/edited times, and soft deletion.
- Replies within a thread.
- Editing with an edited indicator, and deletion that preserves thread structure.
- Thread resolution and unresolution, with resolved threads collapsible.
- The Comments/Activity tab rendering general threads.

## Non-scope

- Timestamp anchors (task `091`), lyric anchors (task `092`), voice notes (task `093`).
- Reactions and mentions (task `094`).
- Realtime comment delivery — request/response with refresh is sufficient for iteration one.

## Dependencies

`042`, `026`

## Files expected to change

```
packages/db/src/schema/comments.ts
apps/web/components/comments/**
apps/web/app/api/songs/[songId]/comments/**
packages/contracts/src/comments.ts
```

## Implementation notes

- The anchor discriminator is designed once, here, to carry all three anchor types. Retrofitting anchors onto a flat comment table later is a migration nobody enjoys.
- Deleting a comment with replies must preserve structure — tombstone it rather than removing the row, so the thread still reads coherently.
- Commenting requires the commenter role or above (`docs/DESIGN.md` §3). Viewers read but cannot post.
- Comment bodies are user input rendered to other users; rely on React escaping and store plain text with a constrained mention syntax rather than HTML.
- Resolution is a thread property, not a comment property.

## Security/privacy considerations

Comment bodies are untrusted user input rendered to other collaborators — stored as plain text, never HTML, and escaped on render. Posting requires commenter role, enforced through `assertCan`. Comments are registered in the task `023` IDOR suite. Editing and deletion are restricted to the author and to editors, and are audited.

## Acceptance criteria

- [ ] Threads support general, timestamp, and lyric anchors by discriminator.
- [ ] Comments support replies within a thread.
- [ ] Editing shows an edited indicator; deletion tombstones and preserves structure.
- [ ] Threads can be resolved and unresolved, and resolved threads collapse.
- [ ] Posting requires commenter role or above; viewers cannot post.
- [ ] Bodies are stored as plain text and escaped on render.
- [ ] Comments appear in the task `023` IDOR suite.
- [ ] Edits and deletions are authorized and audited.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Post a comment, reply, edit, and resolve the thread.
2. Delete a comment with replies and confirm the thread still reads correctly.
3. Attempt to comment as a viewer and confirm refusal.

## Rollback/compatibility

Additive. Reverting after comments exist would lose conversation — do not revert.

## Status

`pending`

## Commit

_(not yet)_
