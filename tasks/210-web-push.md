# 210 — Web Push notifications

**Phase:** Platform · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add Web Push for the PWA, honestly scoped to what iOS actually supports.

## User value

Being told about a new mix without having the app open.

## Scope

- Push subscription management per device.
- VAPID configuration and a push-sending path from the job runtime.
- Integration with the existing notification preferences (task `096`).
- iOS-specific handling: push requires Home Screen installation.
- Clear permission prompting with context.
- Honest documentation of platform limitations.

## Non-scope

- Native iOS push (task `214`).
- Push for every event type — only the ones users actually want interrupting them.
- Guaranteed delivery, which Web Push does not provide.

## Dependencies

`100`, `096`

## Files expected to change

```
apps/web/app/sw.ts
apps/web/lib/push/**
apps/jobs/src/push.ts
docs/OPERATIONS.md
```

## Implementation notes

- iOS requires the PWA to be installed to the Home Screen before push works at all, and delivery is less dependable than native (`docs/OPERATIONS.md` §9). Say so in the UI rather than letting users conclude the feature is broken.
- Request permission with context and at a moment the user would want it — not on first load, which gets a permanent denial.
- Push is an addition to in-app notifications, never a replacement. In-app remains the required channel (`docs/DESIGN.md` §7).
- Handle subscription expiry and renewal; push subscriptions go stale silently.
- Default push to off for most event types. An unexpected push about a routine comment is how people disable notifications entirely.

## Security/privacy considerations

Push payloads travel through a third-party push service. Include minimal content — enough to know something happened, not lyric text or song titles where avoidable. Subscriptions are per device and revocable, and must be cleared on sign-out.

## Acceptance criteria

- [ ] Push subscriptions are managed per device and cleared on sign-out.
- [ ] VAPID is configured and push sends from the job runtime.
- [ ] Push integrates with existing notification preferences.
- [ ] iOS Home Screen requirement is explained in the UI.
- [ ] Permission is requested with context, not on first load.
- [ ] Payload content is minimized.
- [ ] Subscription expiry is handled.
- [ ] Limitations are documented in `docs/OPERATIONS.md` §9.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/jobs test
```

## Manual QA

1. Install to Home Screen on iPhone, enable push, confirm delivery.
2. Sign out and confirm the subscription is cleared.
3. Let a subscription expire and confirm graceful renewal.

## Rollback/compatibility

Additive. Reverting removes push; in-app notifications continue.

## Status

`pending`

## Commit

_(not yet)_
