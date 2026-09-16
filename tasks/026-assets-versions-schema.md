# 026 — Assets, immutable versions, and storage objects schema

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Define the file layer: logical assets, immutable versions, storage object records, derivatives, the mix version stack with its current pointer, and folder snapshot manifests.

## User value

Every upload becomes a permanent, retrievable version. Nothing overwrites anything. The version stack under a song is the song's history.

## Scope

- `assets`: logical file with kind, name, tags, and placement within the single Project Files area.
- `asset_versions`: immutable, one storage object each, with uploader, note, and created time.
- `storage_objects`: bucket, opaque key, size, checksum, content type.
- `derivatives`: streaming audio, waveform peaks, thumbnails — regenerable, multiple rows per version permitted.
- `mix_versions` ordered per song, with `songs.current_version_id` as the current pointer.
- `snapshots` and `snapshot_entries`: relative path, size, mtime, checksum, ignored flag; immutable once finalized.
- Audio metadata columns: duration, codec, channels, sample rate, bit depth, integrated loudness, true peak, processing status.

## Non-scope

- Upload session tables (task `051`).
- Media job tables (task `064`).
- The Project Files UI (task `057`).

## Dependencies

`021`, `025`

## Files expected to change

```
packages/db/src/schema/{assets,versions,storage-objects,snapshots}.ts
packages/db/src/schema/{songs,projects}.ts        (composite tenant keys)
packages/db/migrations/0004_file_layer.sql
packages/db/src/__tests__/{versions.test.ts,schema.test.ts,factories.ts}
packages/authz/src/scoped-query.ts
packages/authz/src/__tests__/resources.ts
```

`derivatives` lives in `versions.ts` beside `asset_versions` and `mix_versions` rather than in
its own file: it is meaningless without a version, and splitting it would put three tables that
are always read together in three places.

## Implementation notes

- Immutability of `asset_versions` must be enforced, not just intended — reject updates to byte-identifying columns at the database level. 'Originals are sacred' is a schema property, not a code convention.
- The `derivatives` table permits several rows per version so an Opus derivative (deferred `205`) or HLS variants (deferred `206`) are additive, not a migration.
- One **Project Files** area only, per the design's confirmed amendment. Organization is folders and tags on `assets` — there is no Logic or MPC column, and none is to be added.
- `songs.current_version_id` gets its FK constraint here, completing the forward reference left in task `021`.
- Snapshot entries need a normalized relative path with traversal rejected at write time, not just at upload time (THREAT_MODEL T4).

## Security/privacy considerations

Immutable originals are the control against data loss and tampering (T8). Snapshot relative paths are untrusted input and are a path-traversal vector (T4) — normalize and reject at the schema boundary. Checksums enable the storage reconciliation in `docs/OPERATIONS.md` §5.

## Acceptance criteria

- [x] Assets, versions, storage objects, derivatives, mix versions, and snapshots exist with
      correct relations — and every parent reference is now workspace-checked. See below.
- [x] `asset_versions` byte-identifying columns are immutable, enforced by a database trigger.
      The analysis columns are deliberately excluded and that is tested both ways.
- [x] The current pointer follows the newest mix automatically and **cannot** reference another
      song's version — a composite foreign key, not a trigger.
- [x] Multiple derivatives per version are supported: four rows of three kinds in one test,
      including two `streaming_audio` variants, so ADR 0004's AAC and deferred `205`'s Opus are
      rows rather than a migration.
- [x] Exactly one Project Files area. Organization is `folder_path` + `tags`, and a test
      asserts no column in `assets` matches `/logic|mpc|ableton|daw/i`.
- [x] Snapshot relative paths reject traversal, absolute paths, drive letters, backslashes,
      `.` and `..` segments, doubled and trailing slashes — ten rejected inputs, and four
      accepted ones so the constraint does not over-reach.
- [x] Every table is workspace-scoped with a leading index and registered in the task `023`
      IDOR suite, which generates the cross-workspace cases for all seven.

## Verification

```
@youandfriends/db     214 tests
@youandfriends/authz  514 tests   (up from 500: the registry generates cases for 7 new tables)
release-check: 10 gates, all pass
```

## A tenancy gap closed while implementing

A plain `assets.song_id -> songs.id` says nothing about tenancy: a row could carry
`workspace_id = A` while pointing at a song in workspace B. Nothing in the product would write
that — but "nothing would write that" is a claim about code, and `docs/THREAT_MODEL.md` T1 asks
for a claim about the database. Task `021` made the same guarantee for folder parents with a
trigger; this is the declarative version.

Every parent reference in the file layer now travels with its workspace: `(child_id,
workspace_id)` referencing a `(id, workspace_id)` unique key on the parent. The sharpest case
is `asset_versions.storage_object_id` — a version pointing at another tenant's storage object
would make a presigned URL for someone else's bytes reachable through my own workspace. Six
tests cover the refusals and one covers the ordinary case, because over-constraining is its
own failure.

## Decisions taken

- **Immutability protects the bytes, not what we learned about them.** The trigger rejects
  changes to `asset_id`, `workspace_id`, `version_number`, `storage_object_id`, `uploaded_by`,
  and `created_at`. Duration, codec, loudness, and processing state stay writable: an ffprobe
  pass that failed and was retried must be able to write its answer, and a better loudness
  algorithm must be able to re-run over old files.
- **The current pointer is a composite foreign key, not a trigger.** A trigger is one more
  thing that can be dropped, disabled, or raced.
- **The pointer only moves forward.** A back-filled or out-of-order version does not silently
  move it past a newer mix someone is already listening to.
- **`folder_path` is a string, not a second folder table.** These folders organize assets
  inside one area; giving them rows would invite grants on them, and `docs/DESIGN.md` §3 is
  explicit that grants target folders, projects, and songs — not this.
- **An asset has exactly one owner**, a song or a project. Neither leaves it unreachable from
  any surface; both makes "where does this live" a question with two answers.
- **A finalized snapshot is sealed**, including its entries — but it can still be trashed.
  Trashing is not editing.
- **`size_bytes` is `bigint`.** A 2 GB original overflows a 32-bit column, and the ceiling in
  `YOUANDFRIENDS_MAX_OBJECT_BYTES` is exactly 2 GB.

## Review findings, and what happened to each

Two read-only reviews ran against this task. Between them they found seven things; four were
inside scope and are fixed here, two became task `028`, and one was a comment.

**Fixed here (in scope):**

- **The tenancy pairs missed two of three references to `storage_objects`.** `asset_versions`
  got one; `derivatives` and `snapshots` did not. A derivative is the streamable audio and a
  snapshot's object is a whole project folder as a ZIP — a row in my workspace pointing at
  another tenant's object is a stream endpoint handing me their music. Worse than the gap
  itself: pairing one of them made the class _look_ closed. Verified accepted before the fix,
  refused after.
- **`ON DELETE SET NULL` on the composite pointer nulled `songs.id`.** A bare `SET NULL` on a
  composite foreign key nulls _every_ referencing column, and the referencing pair is
  `(current_version_id, id)`. Deleting the current mix failed with a not-null violation on the
  songs primary key — a message naming the wrong problem entirely. The Postgres 15+ column
  list, `ON DELETE SET NULL ("current_version_id")`, confines it. Two tests now cover deleting
  the current mix and deleting an older one.
- **The path constraint was a deny-list, and a review got past it seven ways.** Fullwidth
  solidus and fullwidth stop (which NFKC-normalize to `../`), percent-encoded `%2e%2e`, an
  embedded newline that `(^|/)` does not treat as a boundary, an NFD spelling that defeats the
  unique index, a space-padded `.. ` segment, and no length bound at all. It is now an
  allow-list — printable ASCII, NFC-normalized, bounded at 1024 — and every literal the review
  found is in the rejected set. The sibling constraint on `assets.folder_path` had the same
  shape and got the same treatment.
- **The generated cross-workspace cases were vacuous.** They created an empty second workspace
  and asserted nothing leaked from it; deleting the tenant filter from `scopedQuery` would not
  have failed one. Every registered resource now carries a `seed` function, the type requires
  it, and a second generated case asserts the seeder really inserted something. Verified by
  deleting the tenant filter: 15 cases fail by name, and pass again when restored.
- **Immutability covered three of six guarded columns**; `workspace_id`, `uploaded_by`, and
  `created_at` could have broken silently. Now covered.
- **A test that asserted nothing.** "Still allows a finalized snapshot to be trashed" used
  `.resolves.toBeDefined()` on an UPDATE, which a zero-row update satisfies. It reads the row
  back now.
- **Loose error matchers.** `/song_id/` would match an unrelated foreign key message; each
  now names its constraint exactly.

**Became task `028` (beyond scope):** purge does not reach `storage_objects`, so hard-deleting
a song orphans them forever; and `assets`/`snapshots` carry soft-delete columns that nothing
cascades to or scans. Both are task `025`'s files, and both were promised to this task by
comments that lapsed silently — registering the tables satisfied the registry guard, which
checks for a cross-tenant test rather than for purge awareness. The three now-false comments
were corrected here to point at `028` rather than left asserting behaviour the code lacks.

**Noted, not acted on:** `asset_versions` immutability is enforced against `UPDATE` only;
`DELETE` is governed by the purge path, which is `028`'s. The trigger comment says so now.

## A constraint that could not be written

The path check originally included `position(E'\x00' in relative_path) = 0`. That is a syntax
error: Postgres `text` cannot contain a NUL byte, so the literal is invalid and the database
already refuses the input. The migration dry run caught it before it reached anything.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test
pnpm --filter @youandfriends/db migrate:dry
```

## Manual QA

1. Insert a version, attempt to mutate its checksum, confirm rejection.
2. Create three mix versions and confirm the current pointer follows the newest.
3. Attempt a snapshot entry with `../` in its path and confirm rejection.

## Rollback/compatibility

Additive migration. Central to phases 5–7; reverting breaks them.

## Status

`complete`

## Commit

_(not yet)_
