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

- [x] Preferences exist per user, per event type, per channel. (`notification_preferences` holds only choices that differ from the default; `notification_settings` holds the email mode. Both are a person's own, across workspaces, not tenant rows, and are argued as such in both schema registries. The API has no id to point elsewhere; tests show one person's changes never touch another's.)
- [x] The preferences UI groups events sensibly with conservative defaults. (Conversation, Uploads and versions, Lyrics and details, Access. Every event is on in the app. Email is on only for mentions, access changes, invitations, and failed uploads, and off for every comment.)
- [x] In-app notifications cannot be disabled entirely. (Mentions, access changes, invitations, and failed uploads are always in-app: shown on and locked, refused by the API, and held on even against a stored row. The rest can be switched off one at a time; there is no switch for the channel. A row wanted only by email is kept for email and never listed.)
- [x] Email sends via Resend when configured, in immediate and digest modes.
  - Immediate: the web tier hands the new rows to the `notification-email` Trigger.dev task.
  - Daily: a scheduled `notification-digest` sends one email per person. It also sweeps up any immediate email the queue failed to deliver, late rather than lost.
  - Resend is called over its HTTP API with an idempotency key, so a retried job never sends twice.
- [x] With no provider configured, email options are absent or clearly unavailable — never silently broken.
  - Email is available only with `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `YOUANDFRIENDS_EMAIL_LINK_SECRET`, `YOUANDFRIENDS_APP_URL`, and the queue.
  - Without them the page says email isn't set up and shows no email switch or mode, and the API refuses email choices. No row is marked for email.
  - The worker without configuration leaves rows `pending` rather than calling them sent.
- [x] Access is re-checked at send time; email content is minimized. (Access to the song or project, the target not trashed, membership, invitation still pending and addressed to them, and the preference still on. Any failure is `skipped`, as tests with revoked access, a trashed song, and email switched off show. The email is one sentence and a link; a test proves the comment's words never appear. Mutation-checked.)
- [x] Unsubscribe links are signed, scoped, and single-purpose. (HMAC over a fixed purpose, naming only a person and one event, or "all" from a digest. Altering either part fails, as does any other secret or anything signed for another purpose.)
  - Opening `/unsubscribe` changes nothing; its button POSTs.
  - One-click `List-Unsubscribe-Post` is honoured.
  - Only these two exact paths are public, with lookalikes proven protected.
  - Following a link can only switch email off.

**Not verified here.** No real Resend account or Trigger.dev deployment was used; the sender was tested against a recording stand-in and its HTTP shape asserted. Manual QA 1–3 need a configured environment. The digest runs daily at 06:07 UTC, not at each person's local morning — a later refinement.

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

`complete`

## Commit

`2d1c0ca`
