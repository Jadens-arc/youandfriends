# 201 — Share links — passwords and expiry

**Phase:** External sharing · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add optional password protection using a strong password hash, and optional expiration, to external share links.

## User value

Sending something sensitive with a second factor, or a link that stops working after the week it was needed.

## Scope

- Optional per-link password with an Argon2id verifier.
- Optional expiration with clear display of remaining validity.
- A password entry view with generic failure messaging.
- Password change and removal on an existing link.
- Expiry enforcement server-side, never client-side.

## Non-scope

- Per-recipient credentials.
- One-time-use links.
- Email delivery of links.

## Dependencies

`200`

## Files expected to change

```
packages/db/src/schema/share_links.ts
apps/web/app/s/[linkId]/password/**
packages/authz/src/share-links.ts
```

## Implementation notes

- Argon2id, never a fast hash. A share-link password is a password and is subject to offline attack if the database leaks.
- The failure message must not distinguish 'wrong password' from 'no such link' or 'expired link' — that distinction is an enumeration oracle (T5).
- Expiry is enforced server-side on every request, never by hiding the UI.
- Store only the verifier, never the password.

## Security/privacy considerations

Direct T5 control. Argon2id verifier, generic failure messages, server-side expiry enforcement. Combined with task `202`'s rate limiting, this closes the brute-force path.

## Acceptance criteria

- [ ] Passwords use an Argon2id verifier; plaintext is never stored.
- [ ] Failure messages do not distinguish wrong password from missing or expired link.
- [ ] Expiry is enforced server-side on every request.
- [ ] Remaining validity is displayed to the link creator.
- [ ] Password change and removal work on existing links.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm --filter web test
```

## Manual QA

1. Create a password-protected link and confirm access requires the password.
2. Try a wrong password, a revoked link, and an expired link; confirm indistinguishable responses.
3. Let a link expire and confirm server-side refusal.

## Rollback/compatibility

Additive. Reverting removes protection from links that were created expecting it — revoke them first.

## Status

`pending`

## Commit

_(not yet)_
