# 096 — Notification preferences and email delivery

**Phase:** Comments, voice notes, notifications · **Iteration:** one

## Objective

Let each user configure notifications by event type and channel, with optional email delivery via Resend that degrades cleanly when unconfigured.

## User value

Being told about the things you care about, through the channel you want, and nothing else.

## Scope

- `notification_preferences` per user, per event type, per channel.
- A preferences UI grouped by event category with sensible defaults.
- In-app channel always available (required by `docs/DESIGN.md` §7).
- Email delivery via Resend when configured, with digest and immediate modes.
- Clean degradation when no email provider is configured — the option is absent or clearly marked unavailable, never a silent failure.
- Unsubscribe links in emails that map back to preferences.

## Non-scope

- Web Push (deferred `210`).
- SMS or other channels.
- Per-song or per-project notification granularity — deferred pending real usage.

## Dependencies

`095`, `002`

## Files expected to change

```
packages/db/src/schema/notifications.ts
apps/web/app/(workspace)/settings/notifications/**
apps/jobs/src/email.ts
apps/web/app/api/notifications/preferences/**
```

## Implementation notes

- Degrade cleanly and **visibly**. If Resend is not configured, email options must be absent or explicitly marked unavailable. An enabled toggle that silently does nothing is exactly the kind of fake capability the build prompt forbids.
- In-app notification cannot be disabled — it is the required channel (`docs/DESIGN.md` §7). Preferences govern which events, not whether in-app exists.
- Email content must respect access: never include lyric text or song titles the recipient may have lost access to by the time it sends. Re-check at send time.
- Digest mode needs a scheduled job; immediate mode sends on the event. Both go through the same authorization re-check.
- Unsubscribe links must be signed and single-purpose — an unsubscribe link that can be manipulated into changing other settings is a real vulnerability.
- Defaults should be conservative: mentions and access changes on, every comment off. Noisy defaults get all notifications disabled.

## Security/privacy considerations

Email leaves our trust boundary and may sit in an inbox indefinitely. Content is minimized — enough to know something happened, not a full lyric reproduction. Access is re-checked at send time. Unsubscribe links are signed, scoped, and single-purpose. Email addresses are handled per the privacy commitments in `docs/DESIGN.md` §13.

## Acceptance criteria

- [ ] Preferences exist per user, per event type, per channel.
- [ ] The preferences UI groups events sensibly with conservative defaults.
- [ ] In-app notifications cannot be disabled entirely.
- [ ] Email sends via Resend when configured, in immediate and digest modes.
- [ ] With no provider configured, email options are absent or clearly unavailable — never silently broken.
- [ ] Access is re-checked at send time; email content is minimized.
- [ ] Unsubscribe links are signed, scoped, and single-purpose.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/jobs test
pnpm --filter @youandfriends/config test
```

## Manual QA

1. Disable a category and confirm those notifications stop.
2. Unset the Resend key and confirm email options degrade visibly, not silently.
3. Revoke access between event and digest send; confirm the email omits it.

## Rollback/compatibility

Additive. Reverting loses preferences; in-app notifications continue with defaults.

## Status

`pending`

## Commit

_(not yet)_
