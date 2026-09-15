# 209 — Public signup and onboarding

**Phase:** Administration · **Iteration:** **deferred** (post-iteration-one)

## Objective

Open signup beyond invitation, with onboarding, email verification, and abuse prevention.

## User value

Growing beyond the first private workspace.

## Scope

- Public signup with email verification.
- Onboarding creating a first workspace with guidance.
- Abuse prevention: rate limiting, disposable-email handling, and storage limits for new accounts.
- Terms and privacy acceptance recorded.
- A migration path for invited users who later want their own workspace.

## Non-scope

- Social login beyond what Clerk provides.
- Referral programs.
- Public discovery or profiles — an explicit product non-goal.

## Dependencies

`208`, `032`

## Files expected to change

```
apps/web/app/(auth)/sign-up/**
apps/web/app/onboarding/**
packages/authz/src/rate-limit.ts
```

## Implementation notes

- Iteration one is invitation-only by design. Opening signup changes the threat model substantially: unauthenticated users can create storage-consuming accounts.
- Terms and privacy acceptance must be recorded with version and timestamp — a legal requirement, not a nicety.
- New accounts need conservative storage limits until some trust signal exists, or the free tier becomes a free file host.
- Reuse the task `202` rate-limit primitive rather than building another.
- The privacy commitments in `docs/DESIGN.md` §13 — particularly no AI training on user content — must appear in the published terms.

## Security/privacy considerations

Public signup is a significant threat-model change. Rate limiting, email verification, and conservative new-account quotas are required before opening it. The abuse surface must be reviewed by the `security-reviewer` agent as a whole, not incrementally.

## Acceptance criteria

- [ ] Public signup works with email verification.
- [ ] Onboarding creates a first workspace with guidance.
- [ ] Rate limiting and new-account quotas prevent abuse.
- [ ] Terms and privacy acceptance are recorded with version and timestamp.
- [ ] Published terms reflect the `docs/DESIGN.md` §13 commitments.
- [ ] The threat model is updated and reviewed for the open-signup posture.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
pnpm test:e2e -- signup
```

## Manual QA

1. Sign up, verify email, complete onboarding.
2. Attempt rapid repeated signups and confirm rate limiting.
3. Confirm acceptance records are stored.

## Rollback/compatibility

**Requires legal review of terms and privacy policy before shipping.** Do not open signup without it.

## Status

`pending`

## Commit

_(not yet)_
