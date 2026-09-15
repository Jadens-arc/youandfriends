# 056 — Mix version stack and current pointer

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Implement mix version behavior: a new upload creates an immutable version and becomes current, earlier versions remain available, and versions display their full metadata.

## User value

A song's history, intact. Every mix ever bounced, never overwritten, always retrievable.

## Scope

- Uploading a mix creates an immutable version record and updates the song's current pointer.
- The version list showing upload time, uploader, optional note, duration, format, sample rate, bit depth, loudness, and processing status.
- A version selector making the current version unmistakable.
- Setting an earlier version as current, without deleting anything.
- Per-version notes, editable by the uploader and editors.
- Version-level download of the untouched original, gated on `can_download`.

## Non-scope

- A/B playback switching (task `075`).
- Version comparison beyond A/B.
- Automatic version naming or numbering schemes beyond ordinal.

## Dependencies

`051`, `026`, `042`

## Files expected to change

```
apps/web/components/song/versions/**
apps/web/app/api/songs/[songId]/versions/**
packages/db/src/queries/versions.ts
apps/web/components/song/versions/__tests__/**
```

## Implementation notes

- Version immutability is enforced at the schema level (task `026`); this task must not add a mutation path that circumvents it. Notes are mutable; bytes and identity are not.
- Making an older version current is a pointer update, never a copy and never a delete. The stack is append-only.
- Processing status must be visible per version — a version whose media job has not finished should say so rather than appearing broken.
- Download serves the untouched original, not the derivative (`docs/DESIGN.md` §5), and is gated on the independent `can_download` capability, not on role.
- Show loudness and true peak once measured (task `061`); these are what make A/B comparison meaningful to a mixing engineer.

## Security/privacy considerations

Download is gated on `can_download`, which is independent of role — a viewer may download, an editor may not. Download URLs are short-TTL presigned and issued only after the check (T3). Every download is audited (`docs/DESIGN.md` §13).

## Acceptance criteria

- [ ] A new mix upload creates an immutable version and becomes current.
- [ ] Earlier versions remain fully available.
- [ ] Versions display all required metadata including processing status.
- [ ] The current version is unmistakable in the selector.
- [ ] An earlier version can be made current without data loss.
- [ ] Notes are editable; bytes and identity are not.
- [ ] Download serves the original, is gated on `can_download`, and is audited.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Upload three mixes and confirm each becomes current in turn with all versions retained.
2. Set version one as current and confirm nothing is deleted.
3. As a viewer with `can_download` false, confirm download is unavailable and the API refuses it.

## Rollback/compatibility

Additive. Reverting after versions exist would strand the current pointer.

## Status

`pending`

## Commit

_(not yet)_
