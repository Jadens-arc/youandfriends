# 032 — Memberships and invitations

**Phase:** Authentication and workspace · **Iteration:** one

## Objective

Let an owner (or a delegate with the invite capability) invite a collaborator by email, assign scope and role, and have the invitee land in the right place on acceptance.

## User value

The 'and Friends' part. Bringing a collaborator into exactly the folder, project, or song intended — and no further.

## Scope

- `invitations`: email, workspace, scope (folder/project/song), role, capabilities, token, expiry, state.
- Invite flow for owners and delegates holding `can_invite`.
- Acceptance flow binding the invitation to the accepting Clerk identity and creating the membership and grant atomically.
- Revocation and expiry of pending invitations.
- Member list with role and scope display, role changes, and removal.
- Audit events for invite, accept, revoke, role change, and removal.

## Non-scope

- External share links without accounts (deferred `200`–`202`).
- Bulk invitation or directory sync.
- Email template design beyond a functional message.

## Dependencies

`031`, `023`, `024`

## Files expected to change

```
packages/db/src/schema/invitations.ts
apps/web/app/(workspace)/settings/members/**
apps/web/app/api/invitations/**
packages/authz/src/invite.ts
packages/authz/src/__tests__/invitations.test.ts
```

## Implementation notes

- Invitation tokens are opaque high-entropy values, single-use, hashed at rest exactly like sync tokens (ADR 0005). A guessable invitation token is a workspace breach.
- Acceptance must be atomic: membership plus grant plus audit in one transaction, or a half-accepted invitation leaves a member with no access or a grant with no member.
- An invitation must bind to the email it was sent to. Accepting with a different identity is a privilege-transfer vector — either reject, or require an explicit owner-approved rebind.
- The invite capability is independent of role (`docs/DESIGN.md` §3). An editor without `can_invite` cannot invite; a commenter with it can.
- Accepting an expired or revoked invitation must fail closed with a generic message that does not reveal whether the invitation ever existed.
- **Order against provisioning (from `031`, ADR 0009).** Anyone signed in with no membership is provisioned a workspace of their own on their first authenticated render. If an invitation is accepted _after_ that render, the collaborator ends up with an empty workspace beside the one they were invited to. Accept before the workspace shell renders (for example in the sign-up redirect target), or accept that outcome deliberately.
- **Clear a removed member's workspace preference.** The `yaf_workspace` cookie is re-checked on every request, and a preference naming a workspace someone no longer belongs to is refused and recorded as `access.denied` in that workspace — on every request, until it is replaced. Removal should therefore be followed by the removed person's next request resetting the cookie (a switcher that sets it via `maySelectWorkspace`, or resolution writing the fallback back through a route handler or server action).

## Security/privacy considerations

Invitations create access, so they are a primary escalation vector (T2). Tokens are high-entropy, single-use, hashed, and expiring. Acceptance is atomic and audited. Enumeration of invitation tokens must be rate-limited and must not distinguish 'expired' from 'never existed'.

## Acceptance criteria

- [ ] Owners and `can_invite` holders can invite at folder, project, or song scope with a role.
- [ ] Invitation tokens are high-entropy, single-use, hashed at rest, and expiring.
- [ ] Acceptance creates membership, grant, and audit atomically.
- [ ] An invitation cannot be accepted by a different email without explicit rebind.
- [ ] Expired and revoked invitations fail closed with a generic message.
- [ ] Revocation takes effect immediately.
- [ ] Role changes and removals take effect on the next request and are audited.
- [ ] The task `023` matrix covers invited-collaborator access at each scope.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/authz test
pnpm --filter web test
pnpm release-check
```

## Manual QA

1. Invite a collaborator to one song; accept in another browser; confirm only that song is visible.
2. Revoke a pending invitation and confirm acceptance fails.
3. Change a member's role and confirm the change takes effect on the next request.

## Rollback/compatibility

Additive. Reverting after collaborators exist would strand memberships and grants. Revoke access first if ever necessary.

## Status

`pending`

## Commit

_(not yet)_
