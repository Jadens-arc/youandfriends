# ADR 0010: scope-limited invitations, membership as an optional baseline, and owner departure

- **Status:** accepted
- **Date:** 2026-09-23
- **Task:** 032

## Context

Task `032` lets an owner, or a delegate holding `can_invite`, invite someone by email to a
folder, project, or song — not necessarily the whole workspace — and have that person show up
with exactly that access and nothing more. Four questions had no answer in the plan:

1. **How a scope-limited collaborator avoids the workspace-wide baseline.** `packages/authz`'s
   resolver (task `023`, ADR 0006) already treats `workspace_memberships.role` as a baseline
   applied to every target in the workspace when nothing more specific speaks. That is exactly
   right for a full member and exactly wrong for someone invited to one song — a non-null
   baseline would leak viewer-or-better access to everything else in the workspace, the
   opposite of what "exactly that song" means.
2. **How an invitation token is generated, stored, and verified**, and whether it reuses the
   sync-token shape from ADR 0005.
3. **How an invitation is stopped from minting more access than its sender has**, since
   `can_invite` is delegated independently of role (`docs/DESIGN.md` §3).
4. **What "removal" and "leaving" mean for an owner**, which ADR 0009 left open: "Owners cannot
   be removed in iteration one; if task `032` makes that possible, it decides what happens."

## Decision

**A scope-limited collaborator's membership row carries `role: null`, not a workspace-wide
role.** `workspace_memberships.role` becomes nullable. `ensureScopeLimitedMembership`
(`packages/db/src/queries/workspace.ts`) inserts such a row on acceptance so
`resolveWorkspace` (task `031`) has something to route the person by — the requirement that put
this column on every membership in the first place — without that row's role standing for
whole-workspace access. `authz`'s `loadMembership` (`packages/authz/src/authorizer.ts`) treats a
null-role row exactly as it already treats no row at all: no baseline, so the resolver's
most-specific-wins matching falls through to whatever `permission_grants` rows actually name
this subject at this target — the same code path a share-link or sync-token subject already
exercises. `resolve.ts` itself is unchanged; its matrix tests are unchanged. This is the
central design move of the task: reusing a proven "no baseline" path rather than adding a
second kind of access decision the resolver has to know about.

A full member keeps a non-null role. Someone who is both a full member and separately invited to
a specific song keeps their real role — `ensureScopeLimitedMembership`'s `ON CONFLICT DO
NOTHING` never touches an existing membership row.

**Tokens reuse ADR 0005's shape, hashed with scrypt instead of Argon2id.** An invitation token is
`yaf_invite_<26-char ULID>_<secret>` — the ULID is the invitation's own id, a public lookup key;
the secret is 256 bits of `crypto.randomBytes`, base64url-encoded, generated in
`packages/authz/src/token-hash.ts`. Only `scrypt(secret)` is stored, as a self-describing string
(`scrypt$N$r$p$salt$hash`) so a future cost-parameter change does not invalidate rows written
under the old one. Verification is constant-time. This deliberately departs from ADR 0005's
Argon2id: `argon2` is a native addon, and it built and ran fine in this sandbox, but its
behavior under Next.js's bundler and its portability across Vercel's serverless runtime are both
unproven here, against a security requirement — password/token hashing — where a build-time
failure discovered in production is a worse outcome than a slower, pure-JS primitive. Node's
built-in `crypto.scrypt` needs nothing to bundle and nothing to compile. Both are memory-hard
and neither is the weak point in this design: the token secret's 256 bits of entropy is.

**An invitation cannot offer more than its sender currently holds.** `canGrantAccess`
(`packages/authz/src/invitations.ts`) caps the requested role by `roleAtLeast` against the
inviter's own resolved `EffectiveAccess` at the target, and caps each capability
(`canDownload`, `canInvite`) by whether the inviter holds it themselves — independently, since
capabilities are independent of role. This runs after `assertCan(subject, 'invite', target)`
already confirmed the inviter may invite here at all; it decides what the invitation may then
contain. Without it, a commenter holding only `can_invite` could mint an editor grant at a
target they cannot edit themselves — exactly the escalation `docs/THREAT_MODEL.md` T2 names.
`INVITABLE_ROLES` also excludes `owner` outright, enforced again by a database CHECK
(`invitations_role_not_owner`): owner is workspace-wide administration (`docs/DESIGN.md` §3),
never a scope grant, so no invitation — however delegated — can produce one.

**An owner may remove themselves; the only removal ever refused is the one that would leave
zero owners.** This resolves ADR 0009's open question. The first design considered was a
blanket "you cannot remove yourself" rule ahead of the owner-count check, on the theory that
self-removal needed its own guard — but with only owners able to call `removeMember` at all
(`requireInWorkspace(..., 'manage_members')`), the _only_ path to a self-removal that could ever
reach zero owners was a sole owner removing themselves, which the blanket rule already caught
first, under the wrong error code (`forbidden` instead of `conflict`). The owner-count guard
was dead code behind it. Removing the blanket rule and relying solely on `countOwners(tx,
workspaceId) <= 1` is simpler and more permissive: it is how leaving a workspace works, with no
separate "leave" action, and it still refuses the one state nothing in the product can recover
from.

**`countOwners` alone is not race-safe, and shipped that way before this was caught in
security review.** It is a plain, unlocked read. Being inside the same transaction as the write
it gates is not the same claim as being safe against a _second_ transaction changing a
_different_ owner's row at the same moment: under Postgres's default READ COMMITTED isolation,
two owners removed or demoted concurrently each take their own snapshot, each see the other
still as `owner` because neither write has committed yet, and each concludes the workspace is
safe to leave — a textbook write-skew anomaly, reproduced in
`apps/web/lib/workspace/__tests__/members.test.ts` (looped, since one trial catching the timing
is luck, not proof) and closed by `lockWorkspaceForMembershipWrite`
(`packages/db/src/queries/workspace.ts`): a `SELECT ... FOR UPDATE` on the one `workspaces` row,
run first, inside the transaction, in both `changeMemberRole` and `removeMember`. It serializes
every membership write for a workspace against every other one — coarser than locking only the
owner rows, but simpler to reason about and cheap, since membership writes are not a hot path.
`updateMembershipRole`'s own `FOR UPDATE` on the _target_ row was never the control here; it
only ever protected against a second write to that same row, not against the cross-row race.

**Acceptance is a route, not a Server Action, and lives outside `(workspace)`.**
`apps/web/app/invite/[token]/page.tsx` is reached from a link outside the app (today: shown
once to whoever sent it; task `096` replaces that with email delivery), so it needs a URL a
Server Action does not have. It is a sibling of the `(workspace)` route group rather than nested
inside it, so visiting it never touches `WorkspaceGate` — which resolves, and on a first
sign-in provisions, a workspace before anything inside that layout renders. Accepting an
invitation has to land the membership and grant _before_ that provisioning would otherwise run,
per the task file's own note and ADR 0009's Decision #1; the route boundary is what makes that
ordering structural rather than a discipline someone has to remember. On success it sets
`yaf_workspace` to the invitation's workspace directly, via `next/headers`'s `cookies()`, before
redirecting home — not through a switcher, because none exists yet, and this is the one place a
freshly-granted membership needs the preference set for it immediately rather than falling back
to whichever workspace happens to be oldest.

**Every other member-management surface is a Server Action, not the task file's
`app/api/invitations/**`.** This app has no REST API for same-origin browser mutations — the
existing rename flow (task `031`) is already a Server Action colocated with its page, not a
route handler called by `fetch`. Sending, revoking, changing a role, and removing a member are
all reached only from forms rendered on `members/page.tsx`; a route handler here would exist
only to be called by a `fetch` from the page sitting right next to it. This is a deviation from
the literal file list in `tasks/032-memberships-and-invitations.md`, recorded here per
`tasks/README.md`'s protocol for changes beyond what a task file names.

**A removed member's stale `yaf_workspace` cookie is not cleared by `removeMember` itself.**
`resolveWorkspace` (ADR 0009) already refuses a cookie naming a workspace the requester does not
belong to, on every request, and records the refusal at most once an hour. `removeMember`
deletes the membership row that check depends on; the very next request from the removed person
resolves them into whichever workspace they belong to now (or "Your workspace isn't available"
if none), with no separate cookie-clearing step to keep in sync with the removal path. Handled
by an existing mechanism rather than a new one.

## Consequences

**Easier:** A scope-limited collaborator's access model needed no new concept in `authz` — it is
the same "no baseline" path a share-link subject already takes, so the resolver and its matrix
tests are untouched by this task. Owner departure is one guard instead of two, and the dead-code
branch a naive design would have shipped is gone rather than merely untested.

**Harder:** `workspace_memberships.role` being nullable means every future reader of that column
has to decide what `null` means for its purpose — a decision this ADR makes once here rather
than leaving to be rediscovered per call site. `grantCountsByMember`
(`packages/db/src/queries/permissions.ts`) exists because of it: a scope-limited collaborator's
row in the member-management list has no role to show, so it shows a scope-grant count instead,
without resolving each grant's target to a name (that belongs beside the library browser that
can link to what it names, once one exists — task `040` onward).

**Accepted:** The invitation link is shown once, on the page that sent it, with no email
delivery — the honest shape of what exists without task `096`'s provider integration, not a
fabricated one (CLAUDE.md §7). The scope picker on the invite form is a raw id typed into a text
field, not a browse-and-pick control, because no library browser exists yet either; the field's
own help text says so rather than a control pretending to be more than it is.

## Alternatives considered

**A second `EffectiveAccess`-shaped table for scope-limited members, parallel to
`permission_grants`.** Rejected: it would duplicate the exact mechanism `permission_grants`
already provides for share-link and sync-token subjects, for no reason specific to a member
subject.

**Clearing `yaf_workspace` explicitly inside `removeMember`'s transaction.** Not possible from
where it runs — the person being removed is not the request `removeMember` executes under, so
there is no response to set a cookie on. Left to the removed person's own next request, which
`resolveWorkspace` already handles.

**Argon2id, matching ADR 0005 exactly.** Considered and reverted after installing and testing
it; see Decision above.
