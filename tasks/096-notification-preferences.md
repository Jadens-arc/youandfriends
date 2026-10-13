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

- [x] Preferences exist per user, per event type, per channel.
- [x] The preferences UI groups events sensibly with conservative defaults.
- [x] In-app notifications cannot be disabled entirely.
- [x] Email sends via Resend when configured, in immediate and digest modes.
- [x] With no provider configured, email options are absent or clearly unavailable — never silently broken.
- [x] Access is re-checked at send time; email content is minimized.
- [x] Unsubscribe links are signed, scoped, and single-purpose.

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

## Implementation record

- `notification_preferences` and `notification_emails` (migration `0025`). No row means the
  defaults in `defaultPreference` (contracts): everything in-app; email right away only for
  mentions, access changes, invitations, and a failed upload. Every comment is off by email.
- One delivery path, `deliverNotification` (db), used by the web generator and the media worker.
  In-app follows the person's choice, except for the `ALWAYS_IN_APP` events, which cannot be
  turned off. Email is queued only when email delivery is configured.
- Email availability is `emailConfigFrom` (config). It needs `RESEND_API_KEY`,
  `RESEND_FROM_ADDRESS`, and two new variables: `YOUANDFRIENDS_APP_URL` for links and
  `YOUANDFRIENDS_EMAIL_SIGNING_SECRET` for unsubscribe signatures. Missing any one, the settings
  page says email is unavailable and shows no email control, and the API refuses an email choice.
- `apps/jobs/src/email.ts` sends through Resend's HTTP API: immediate mode every five minutes,
  a digest daily at 08:00 UTC (`src/trigger/notification-emails.ts`). At send time it re-checks
  membership and access to each target and drops what fails, without naming it. Content is one
  sentence and a link per event. No comment text or lyrics are stored or sent. Failed sends
  retry up to five times, then are marked `failed`.
- Unsubscribe links (`packages/authz/src/unsubscribe.ts`) are HMAC-signed over a purpose
  string, person, workspace, and event, and can only turn email off for that event. `/unsubscribe`
  changes nothing on GET (link scanners) and asks for a button press; RFC 8058 one-click POST
  goes to `/api/notifications/unsubscribe`. Both routes are public, and the token is the credential.
- Settings: `/settings/notifications`, linked from Settings.

**Also in this commit:** `packages/authz/src/__tests__/token-hash.test.ts` built its "missing
separator" token from a random secret that starts with `_` one time in 64, making the token
well-formed after all. That failed the release check once. The secret's first character is
now forced to a letter.

**Not verified live:** no Resend account was available, so no email has actually been sent.
The sender is tested with an injected `send`; `resendSender` itself is untested against the
real API.

## Review flag

Fast-tracked at the user's request (2026-10-13); no security-reviewer or test-reviewer pass. The two new public routes and the unsubscribe signing scheme deserve a security read; Resend has never been exercised live.

## Status

`complete`

## Commit

_(not yet)_
