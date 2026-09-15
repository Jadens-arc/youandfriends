# 202 — Share links — rate limiting and enumeration resistance

**Phase:** External sharing · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add rate limiting, enumeration resistance, and abuse monitoring to the share-link surface.

## User value

Links that cannot be found by guessing or broken by grinding.

## Scope

- Rate limiting on link resolution and password attempts, by link and by source.
- Progressive delay on repeated password failures.
- Generic, timing-consistent responses for invalid, revoked, and expired links.
- Monitoring and alerting on unusual access patterns.
- A general-purpose rate-limit primitive reusable across the API.

## Non-scope

- A CAPTCHA.
- IP-based geographic blocking.
- Full bot detection.

## Dependencies

`201`

## Files expected to change

```
packages/authz/src/rate-limit.ts
apps/web/app/api/share-links/**
apps/web/middleware.ts
```

## Implementation notes

- Timing consistency matters as much as message consistency. A response that returns faster for a nonexistent link than for a wrong password is an enumeration oracle regardless of what the message says.
- Rate limit per link and per source. Per-source alone lets a distributed attempt grind one link; per-link alone lets one source enumerate many links.
- Build the primitive generally — several other endpoints will want it.
- Progressive delay is friendlier than hard lockout for a legitimate user who mistyped, and equally effective against grinding.

## Security/privacy considerations

Completes T5. With 128-bit opaque ids, enumeration is already impractical; rate limiting and timing consistency close the password brute-force path and the existence oracle.

## Acceptance criteria

- [ ] Rate limiting applies per link and per source.
- [ ] Repeated password failures incur progressive delay.
- [ ] Invalid, revoked, and expired responses are indistinguishable in content and in timing, proven by test.
- [ ] Unusual access patterns are monitored.
- [ ] The rate-limit primitive is reusable across the API.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm --filter web test
```

## Manual QA

1. Grind a link password and confirm progressive delay.
2. Measure response timing across invalid, revoked, and expired links; confirm consistency.

## Rollback/compatibility

Additive. Reverting weakens link security.

## Status

`pending`

## Commit

_(not yet)_
