# 027 — Seed and demo data

**Phase:** Data, authorization, audit · **Iteration:** one

## Objective

Provide a reproducible seed producing a realistic workspace: nested folders, projects with cover art, songs with version stacks, lyrics, comments, and collaborators at each role.

## User value

Development and QA happen against something that looks like real use, so layout and permission problems surface before a user finds them.

## Scope

- An idempotent seed script safe to re-run.
- A realistic tree: several nested folders, multiple projects, songs with two to four mix versions each.
- Collaborators at viewer, commenter, and editor, including a deny-override case, so permission behavior is visible by default.
- Tiny generated audio fixtures — synthesized tones, a few seconds each.
- A `--reset` flag that clears seeded data without touching anything else.

**Split out:** lyrics with structured blocks, comments including timestamped ones, and
notifications move to task `029`. Their tables are created by tasks `080`, `090`, and `095`,
none of which has run — seeding them here would mean writing against tables that do not exist.
The split is recorded rather than the scope quietly dropped.

## Non-scope

- Performance or load fixtures.
- Any real music. Ever.
- Production data anonymization.

## Dependencies

`026`, `024`

## Files expected to change

```
packages/db/src/seed/**
packages/db/src/seed/fixtures/**
packages/db/bin/seed.mjs
packages/db/package.json
packages/authz/src/__tests__/seeded-grants.test.ts
```

`packages/authz/src/__tests__/seeded-grants.test.ts` is beyond the files this task originally
named, and is recorded here rather than added quietly. The seed's whole reason to exist is that
"permission behaviour is visible by default", and `data.ts` states in prose what each grant
demonstrates. Prose is not a check: every grantee also carries a workspace-wide membership, so a
resolver that dropped scoped grants — or ignored denies — would leave a seeded workspace that
still looked right. The dependency runs authz → db, so `packages/authz` is the only place the
seed and the resolver can meet. `packages/db` gained a `./seed` export for it, which is safe
because `seed` and `reset` require a `SeedPermit` that only the guard can produce.

## Implementation notes

- Audio fixtures must be **generated**, not sourced — a few seconds of synthesized tone at a known sample rate and bit depth. They double as media pipeline fixtures in task `066`, so generate them at several formats (WAV 44.1/16, WAV 48/24, FLAC, MP3, M4A).

  **Encoded formats are not produced here, and that is an open question, not a decision.** FLAC,
  MP3, and M4A need an encoder; ffmpeg is not installed in this environment and does not arrive
  as a dependency until task `064` (ADR 0002's build extension). The generator produces the two
  WAV formats natively — 44.1/16 and 48/24, both stereo — and `encoderAvailable()` returns
  `false` rather than shipping a stub, because a fixture that claimed to be a FLAC and was not
  would make `066`'s media tests pass against something that was never encoded (CLAUDE.md §7).
  The seed CLI prints a **loud** `SKIPPED` line naming the three. Whether that is acceptable for
  this task is recorded as a blocker under Status: it is a scope reduction, and CLAUDE.md §7 puts
  that with the user.

- Generate fixtures with a committed script rather than committing large binaries; commit only what is small and necessary.
- Include the awkward cases deliberately: a very long song title, a project with no cover art, a song with no lyrics, a failed media job. These are the states that break layouts, and a seed that only contains happy paths hides them.
- Idempotency matters — a seed that duplicates on second run makes developers reset unnecessarily.

## Security/privacy considerations

Never commit user music (THREAT_MODEL T9). Fixtures are legally unambiguous generated tones. The seed must never run against production — guard on an explicit environment check that fails closed.

## Acceptance criteria

- [x] The seed produces nested folders, projects, songs, and version stacks.
      Asserted from rows: `folders.depth`/`folders.path` for the three-deep chain, a four-row
      version stack with `songs.current_version_id` on the newest, and every version count
      against `sum(SEED_SONGS.versions)`.
- [x] Collaborators exist at every role plus a deny-override case.
      Asserted from `workspace_memberships` and `permission_grants` rows, and from what those
      rows **resolve to** through `packages/authz`. Verified by mutation: writing the deny as a
      benign allow, or flattening every membership to a no-download viewer, each fail by name.
- [ ] Audio fixtures are generated, tiny, and cover several formats.
      **Two of the five named formats.** WAV 44.1/16 and WAV 48/24 are generated natively.
      FLAC, MP3, and M4A need an encoder that does not exist until task `064`. See the
      implementation notes and the blocker below — this is the user's call, not an agent's.
- [x] Edge cases (long titles, missing art, missing lyrics, failed job) are represented.
      Asserted from rows, not from the constants. "Missing lyrics" is task `029`'s, split out
      before coding because `lyrics_documents` does not exist yet.
- [x] The seed is idempotent and `--reset` works.
      Two runs produce identical counts; `--reset` empties every content table by id, inside one
      transaction, and leaves a foreign workspace and a hand-made folder untouched.
- [x] The seed refuses to run against a production database.
      The **target** is checked, not just the environment label: a remote host is refused even
      with `NODE_ENV=development`, which is the case that would actually have happened.
- [x] No committed binary exceeds a documented small size limit.
      Nothing binary is committed at all; fixtures are generated at run time and
      `MAX_COMMITTED_FIXTURE_BYTES` is documented and enforced.

## Tests and validation commands

The guard refuses an unset `NODE_ENV` and a non-local database, so both have to be supplied;
and the seed writes into tables, so the migrations have to be applied first. Run verbatim:

```bash
# Prerequisites. DATABASE_URL_UNPOOLED must point at a local Postgres.
pnpm --filter @youandfriends/db migrate

NODE_ENV=development pnpm --filter @youandfriends/db seed
NODE_ENV=development pnpm --filter @youandfriends/db seed            # idempotent: same counts
NODE_ENV=development pnpm --filter @youandfriends/db seed -- --reset

# The guard, which is meant to fail. Both exit 2.
pnpm --filter @youandfriends/db seed                                 # NODE_ENV unset
NODE_ENV=production pnpm --filter @youandfriends/db seed

pnpm --filter @youandfriends/db test
pnpm --filter @youandfriends/authz test   # asserts what the seeded grants resolve to
pnpm release-check
```

## Manual QA

1. Run the seed, open the library, confirm it looks like a real workspace.
2. Sign in as each seeded collaborator role and confirm visible content matches the grant.
   Until Clerk lands (task `030`) this is covered by
   `packages/authz/src/__tests__/seeded-grants.test.ts`, which resolves each seeded
   collaborator's access from the written rows.

**Verified this way during implementation**, against a local Postgres:

- Two runs produce identical counts (`folders=5 projects=3 songs=6 mix=12 versions=12
objects=12 grants=4 users=4 workspaces=1`).
- `--reset` leaves `users=4 workspaces=1` and every content table empty, and a folder created
  by hand in the seeded workspace survives it.
- A production connection string in `.env.local` with `NODE_ENV=development` is **refused**:
  `points at ep-…​.aws.neon.tech, which is not local and is not named in
YOUANDFRIENDS_SEED_ALLOW_HOST`. Naming that host allows it.
- Resolution: Tom is `editor` with download inside the Blue Hour folder, `editor` without
  download outside it, and `null` on Careless Weather. Avery is unaffected by that deny.

## Rollback/compatibility

Development-only data. Reverting loses fixtures that later tasks' tests depend on.

## Status

`in-progress`

## Blocker

Encoded audio formats (FLAC, MP3, M4A) need ffmpeg, which arrives with task `064` — whether to defer them is the user's scope decision.

## Notes on the blocker

The task names five fixture formats; two are produced. Nothing is stubbed —
`encoderAvailable()` returns `false` and the CLI prints a loud `SKIPPED` line naming the three —
but two of five is a reduction against what this task asked for, and a reduction is the user's
decision (CLAUDE.md §7), not one an agent makes by rewriting the task's own notes.

Everything else in this task is complete and verified. The choice is between deferring the
encoded fixtures to task `066` (which already owns the full format matrix and already depends on
both `064` and this task) and holding `027` open until ffmpeg is available.

## Commit

_(not yet)_
