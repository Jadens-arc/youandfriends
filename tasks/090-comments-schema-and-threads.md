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

- [x] Threads support general, timestamp, and lyric anchors by discriminator. (`comment_threads.anchor_kind` with a check holding each kind to its own fields; `commentAnchorSchema` is the matching discriminated union. The API accepts `general` only until tasks `091` and `092` add the behaviour behind the other two.)
- [x] Comments support replies within a thread. (In order; a reply moves its thread to the top.)
- [x] Editing shows an edited indicator; deletion tombstones and preserves structure. ("· edited" with the time as its title; a deleted comment's words are erased — in the database, not just hidden — and its place reads "This comment was deleted.")
- [x] Threads can be resolved and unresolved, and resolved threads collapse. (Folded under "N resolved threads", with who resolved each.)
- [x] Posting requires commenter role or above; viewers cannot post. (`comment` through `packages/authz`; viewers get no composer and a 404-shaped refusal — tested.)
- [x] Bodies are stored as plain text and escaped on render. (Plain text in, plain text out, rendered as React text with whitespace kept; control characters and direction overrides refused — tested with markup that stays text.)
- [x] Comments appear in the task `023` IDOR suite. (`comment_threads` and `comments` are live entries, both in `SCOPED_TABLES`.)
- [x] Edits and deletions are authorized and audited. (Edit: the author only. Delete: the author, or anyone who may edit the song. `comment.updated`, `comment.deleted`, `comment.resolved`, `comment.reopened`, and `comment.created` — all against the song, so they join its activity. Scoping mutation-checked.)

**Decision.** The task allows editors to edit anyone's comments; this implementation lets editors _delete_ any comment but lets only authors _edit_ their own — rewriting someone else's words under their name is not something the product needs, and narrower is the safe default.

**Not verified here.** Manual QA 1–3 need a browser (task `120`).

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

`complete`

## Commit

_(not yet)_
