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

- [x] A new mix upload creates an immutable version and becomes current. (`lib/versions/__tests__/service.test.ts`, through the real upload service: `prepareMixUpload` → session → `recordMixVersion`; the `mix_versions_become_current` trigger moves the pointer. Idempotent: the asset version through an existence check under a row lock on the asset (not a unique index — two versions may share an object, which task `028`'s purge relies on), the mix version through the new `mix_versions_asset_version_key` index, migration `0009`; concurrent records get distinct numbers.)
- [x] Earlier versions remain fully available. (Nothing deletes or copies; the stack is append-only.)
- [x] Versions display all required metadata including processing status. (Upload time, uploader, note, duration, format, sample rate, bit depth, loudness, true peak, and a worded processing badge — task `042`'s `VersionDetails`, now with the uploader's own filename via `asset_versions.original_filename`.)
- [x] The current version is unmistakable in the selector. (Task `042`'s "Current" badge in words.)
- [x] An earlier version can be made current without data loss. (`setCurrentVersion` is a pointer update; another song's version id is refused.)
- [x] Notes are editable; bytes and identity are not. (Editors, or the uploader while they can still comment; a deny on the song stops even the uploader. The immutability trigger refusing a storage-object change is re-asserted.)
- [x] Download serves the original, is gated on `can_download`, and is audited. (`GET /api/songs/:songId/versions/:versionId/download` redirects to a five-minute presigned URL signed with the original filename; a viewer without `can_download` and a foreign tenant are refused 404-shaped; `version.downloaded` is written without the URL.)

The upload control on the song page ("Upload new version") uses task `053`'s uploader and is deliberately compact; the full upload surface is task `055`. Media-job enqueueing on a new version is a hook (`VersionContext.onVersionRecorded`) that task `064` fills. The audit vocabulary now names `056` as the emitter of `version.created` and `version.downloaded`.

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

`complete`

## Commit

`f9d642e`
