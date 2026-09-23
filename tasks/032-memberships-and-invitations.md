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

**What actually changed, beyond this list** (CLAUDE.md §11, following task `031`'s precedent):

- No `apps/web/app/api/invitations/**` REST surface. Sending, revoking, changing a role, and
  removing a member are Server Actions colocated with `members/page.tsx`
  (`apps/web/app/(workspace)/settings/members/actions.ts`), the same pattern task `031` already
  established for renaming — this app has no other REST API for same-origin browser mutations.
  `apps/web/app/invite/[token]/page.tsx` _is_ a real route: acceptance is reached from a link
  outside the app, which is what a route is for. See ADR 0010.
- `packages/authz/src/invitations.ts` and `packages/authz/src/token-hash.ts`, not
  `packages/authz/src/invite.ts` — the domain logic split into "deciding what an invitation may
  offer" and "the token scheme", which turned out to be two independently testable concerns.
- Tests landed as `packages/authz/src/__tests__/invite-decision.test.ts`,
  `token-hash.test.ts`, and `scope-limited-membership.test.ts` rather than one
  `invitations.test.ts` — one file per concern, matching how the implementation split.
- `packages/db/src/schema/workspaces.ts` (`workspace_memberships.role` made nullable) and
  `packages/db/src/queries/workspace.ts`/`permissions.ts` changed too: the scope-limited
  membership design (ADR 0010) touches the membership row itself, not only the new
  `invitations` table.
- `apps/web/lib/workspace/members.ts` (role change, removal) and `apps/web/lib/invitations/**`
  (context, service, accept) hold the business logic the Server Actions and the accept route
  call into — matching the existing `apps/web/lib/workspace/settings.ts` pattern rather than
  putting logic directly in route/action files.

## Implementation notes

- Invitation tokens are opaque high-entropy values, single-use, hashed at rest exactly like sync tokens (ADR 0005). A guessable invitation token is a workspace breach. **Deviation:** hashed with `scrypt`, not Argon2id — see ADR 0010 for why.
- Acceptance must be atomic: membership plus grant plus audit in one transaction, or a half-accepted invitation leaves a member with no access or a grant with no member.
- An invitation must bind to the email it was sent to. Accepting with a different identity is a privilege-transfer vector — either reject, or require an explicit owner-approved rebind. **Built:** reject only; no rebind flow exists in iteration one (`docs/THREAT_MODEL.md` T11).
- The invite capability is independent of role (`docs/DESIGN.md` §3). An editor without `can_invite` cannot invite; a commenter with it can.
- Accepting an expired or revoked invitation must fail closed with a generic message that does not reveal whether the invitation ever existed.
- **Order against provisioning (from `031`, ADR 0009).** Anyone signed in with no membership is provisioned a workspace of their own on their first authenticated render. If an invitation is accepted _after_ that render, the collaborator ends up with an empty workspace beside the one they were invited to. Accept before the workspace shell renders (for example in the sign-up redirect target), or accept that outcome deliberately. **Built:** `apps/web/app/invite/[token]/page.tsx` is a sibling of the `(workspace)` route group, so it never touches `WorkspaceGate`'s provisioning; acceptance always runs first structurally, not by discipline.
- **Clear a removed member's workspace preference.** The `yaf_workspace` cookie is re-checked on every request, and a preference naming a workspace someone no longer belongs to is refused and recorded as `access.denied` in that workspace — on every request, until it is replaced. Removal should therefore be followed by the removed person's next request resetting the cookie (a switcher that sets it via `maySelectWorkspace`, or resolution writing the fallback back through a route handler or server action). **Built:** left entirely to `resolveWorkspace`'s existing refusal-and-fallback behavior (ADR 0009); no new cookie-clearing code, since `removeMember` has no response to set a cookie on for the person it removed.
- **Owner departure (not in the original notes, decided during implementation — see ADR 0010).** An owner may remove themselves; the only removal or role change ever refused is one that would leave the workspace with zero owners.
- **Two findings from the required security review, both fixed before this task was marked complete** (`docs/THREAT_MODEL.md` T8, T1; ADR 0010):
  1. The owner-departure guard's `countOwners` was an unlocked read, so two owners demoted or removed concurrently (different rows, same workspace) could each pass the check before either committed — write skew under Postgres's default READ COMMITTED isolation, reaching the exact zero-owner state the guard exists to prevent. Fixed by `lockWorkspaceForMembershipWrite` (`packages/db/src/queries/workspace.ts`), a `SELECT ... FOR UPDATE` on the workspace row taken first in `changeMemberRole` and `removeMember`, serializing concurrent membership writes for one workspace. Reproduced and closed by a looped concurrent test in `apps/web/lib/workspace/__tests__/members.test.ts` — a single trial's timing is not reliable enough to prove the fix.
  2. `packages/authz/src/scoped-query.ts` (task `023`, predating this task) checked only that a `workspace_memberships` row existed, not that its `role` was non-null — a fact that was equivalent to "has workspace-wide access" until this task made `role` nullable. A scope-limited collaborator's real membership row would have satisfied it, handing them the workspace-wide handle `scopedQuery` opens, which is exactly the access a scope-limited invitation exists to withhold. Nothing in this task's own surface calls `scopedQuery`, so this was latent, not exploited — but it would have been the first trap for whichever future task (`040`+) is first to call it with a subject who might hold a scope-limited membership. Fixed by adding `isNotNull(workspaceMemberships.role)` to its membership check, with a cross-workspace-IDOR-style regression test in `packages/authz/src/__tests__/idor.test.ts`.

## Security/privacy considerations

Invitations create access, so they are a primary escalation vector (T2). Tokens are high-entropy, single-use, hashed, and expiring. Acceptance is atomic and audited. Enumeration of invitation tokens must be rate-limited and must not distinguish 'expired' from 'never existed'.

**Gap, recorded rather than silently skipped:** the generic-failure-message half of this is built (`docs/THREAT_MODEL.md` T11). Rate limiting on acceptance attempts is not — this codebase has no rate-limiting infrastructure yet (the first feature that would need one, share links, is deferred to task `200`+), and building one ad hoc for this task alone was judged out of proportion to the actual risk: the token secret is 256 bits of `crypto.randomBytes`, not a short human-chosen value, so brute force is computationally infeasible regardless of request rate. Recorded as an accepted residual risk in `docs/THREAT_MODEL.md`, to be revisited once T5's rate-limiting infrastructure exists.

## Acceptance criteria

- [x] Owners and `can_invite` holders can invite at folder, project, or song scope with a role.
- [x] Invitation tokens are high-entropy, single-use, hashed at rest, and expiring.
- [x] Acceptance creates membership, grant, and audit atomically.
- [x] An invitation cannot be accepted by a different email without explicit rebind (rebind is not built; a mismatch is refused, not silently accepted).
- [x] Expired and revoked invitations fail closed with a generic message.
- [x] Revocation takes effect immediately.
- [x] Role changes and removals take effect on the next request and are audited.
- [x] The task `023` matrix covers invited-collaborator access at each scope.

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

`complete`

## Commit

_(not yet)_
