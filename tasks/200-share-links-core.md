# 200 — External share links — core

**Phase:** External sharing · **Iteration:** **deferred** (post-iteration-one)

## Objective

Implement opaque, no-account share links targeting a folder, project, or song, with a stream-or-download policy, resolving on a separate authorization path that never confers workspace membership.

## User value

Sending a mix to a manager or a mastering engineer without making them create an account.

## Scope

- `share_links`: opaque 128-bit id, target type and id, stream/download policy, per-link audit name, creation and revocation metadata.
- A separate resolution path for share-link bearers as a distinct `authz` subject.
- A public link view with a restrained subset of the interface: playback, metadata, and download if permitted.
- Link creation and management for editors and owners.
- Immediate revocation.
- `share_link_accesses` logging without collecting unnecessary recipient data.

## Non-scope

- Passwords and expiry (task `201`).
- Rate limiting and enumeration resistance (task `202`).
- Commenting by link recipients.

## Dependencies

`023`, `056`

## Files expected to change

```
packages/db/src/schema/share_links.ts
packages/authz/src/subjects.ts
apps/web/app/s/[linkId]/**
apps/web/app/api/share-links/**
```

## Implementation notes

- The schema and authorization seam were established in iteration one (tasks `022`, `026`) precisely so this is additive rather than a rework.
- A share link **never** creates workspace membership and is evaluated on its own path (`docs/DESIGN.md` §8). This is the rule that keeps the two models from contaminating each other.
- Never expose permanent object URLs — short-TTL presigned URLs only, after link validation (T3).
- Download is a per-link policy, independent of the workspace `can_download` capability.
- Log access events without collecting more recipient data than needed for auditability.

## Security/privacy considerations

This is THREAT_MODEL T5. Links are 128-bit opaque ids. Access is logged. No permanent object URLs. The bearer subject must be unable to reach anything outside the link's target — an explicit IDOR test is required, reusing the task `023` helper.

## Acceptance criteria

- [ ] Links target a folder, project, or song and resolve on a separate authorization path.
- [ ] A link never creates workspace membership, proven by test.
- [ ] Stream-only and download-enabled policies are enforced server-side.
- [ ] The public view exposes only permitted content and actions.
- [ ] Revocation takes effect immediately.
- [ ] Object URLs are short-TTL presigned, never permanent.
- [ ] Access events are logged with minimal recipient data.
- [ ] A bearer cannot reach anything outside the link target.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm --filter web test
```

## Manual QA

1. Create a stream-only link, open it in a private window, confirm playback works and download does not.
2. Revoke it and confirm immediate failure.
3. Attempt to reach a sibling song from the link context.

## Rollback/compatibility

Additive. Revoke all links before reverting.

## Status

`pending`

## Commit

_(not yet)_
