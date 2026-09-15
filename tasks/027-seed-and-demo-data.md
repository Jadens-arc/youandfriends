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
- Lyrics with structured blocks, comments including timestamped ones, and notifications.
- A `--reset` flag that clears seeded data without touching anything else.

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
package.json
```

## Implementation notes

- Audio fixtures must be **generated**, not sourced — a few seconds of synthesized tone at a known sample rate and bit depth. They double as media pipeline fixtures in task `066`, so generate them at several formats (WAV 44.1/16, WAV 48/24, FLAC, MP3, M4A).
- Generate fixtures with a committed script rather than committing large binaries; commit only what is small and necessary.
- Include the awkward cases deliberately: a very long song title, a project with no cover art, a song with no lyrics, a failed media job. These are the states that break layouts, and a seed that only contains happy paths hides them.
- Idempotency matters — a seed that duplicates on second run makes developers reset unnecessarily.

## Security/privacy considerations

Never commit user music (THREAT_MODEL T9). Fixtures are legally unambiguous generated tones. The seed must never run against production — guard on an explicit environment check that fails closed.

## Acceptance criteria

- [ ] The seed produces nested folders, projects, songs, and version stacks.
- [ ] Collaborators exist at every role plus a deny-override case.
- [ ] Audio fixtures are generated, tiny, and cover several formats.
- [ ] Edge cases (long titles, missing art, missing lyrics, failed job) are represented.
- [ ] The seed is idempotent and `--reset` works.
- [ ] The seed refuses to run against a production database.
- [ ] No committed binary exceeds a documented small size limit.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/db seed
pnpm --filter @youandfriends/db seed   # idempotent
pnpm --filter @youandfriends/db seed -- --reset
```

## Manual QA

1. Run the seed, open the library, confirm it looks like a real workspace.
2. Sign in as each seeded collaborator role and confirm visible content matches the grant.

## Rollback/compatibility

Development-only data. Reverting loses fixtures that later tasks' tests depend on.

## Status

`pending`

## Commit

_(not yet)_
