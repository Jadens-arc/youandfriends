# ADR 0009: workspace provisioning, request-scoped workspace resolution, and session audit

- **Status:** accepted
- **Date:** 2026-09-23
- **Task:** 031

## Context

Task `031` creates a private workspace for a new owner on their first sign-in, and it inherits
the sign-in, sign-out, and failed-access audit that task `030` could not write (every audit row
needs a workspace, and until now nobody had one). Four questions had no answer in the plan:

1. **Who gets a workspace.** Iteration one is invitation-only (`docs/DESIGN.md` §1, public
   sign-up is deferred to `209`). Everyone who can sign in is either an owner or someone
   invited, and the invited collaborator's first sign-in looks exactly like an owner's.
2. **How provisioning survives a stampede.** A first sign-in arrives as several requests at
   once — the page, its data, a prefetch — and each sees a person with no workspace.
3. **Which workspace a request works in**, once a person may belong to more than one.
4. **How the server learns about a sign-out.** It is a conversation between the browser and
   Clerk. Nothing reaches this server.

## Decision

**Provision only for someone with nowhere to be.** A signed-in person with no membership
anywhere gets a workspace they own, named from their Clerk display name (never their email).
Someone who already belongs to a workspace gets nothing new: an invited collaborator is not
handed an empty workspace beside the one they were invited to. Task `032`'s invitation flow
must therefore record the membership **before** the collaborator's first authenticated render,
or they will be provisioned a workspace of their own first. That is harmless but untidy, and it
is noted in `032`.

**Race-safe by constraint.** `workspaces.provisioned_for_user_id` is unique and null except on
provisioned workspaces. Concurrent provisioners all pass the membership check; the insert is
what serialises them, and `ON CONFLICT DO NOTHING` resolves every loser to the winner's row.
This is chosen over an advisory lock around the whole operation because the constraint holds
for every writer, including a future one that forgets the lock.

**Resolve the workspace from the request.** A cookie (`yaf_workspace`) carries a preference.
The membership table decides whether it is honoured, on every request. A preference naming a
workspace the person does not belong to is refused, falls back to their oldest membership, and
is recorded as `access.denied` **in the workspace it named**, because that tenant's owner is
the one who needs to know. A value that is not an id, or names no workspace, is ignored without
a record, since inventing a tenant to attribute it to would put a fabricated row in the log.
Multi-workspace support is then a switcher that sets the cookie (`maySelectWorkspace` is its
check), not a rewrite of every read.

**Session events come from Clerk's webhooks.** `session.created` → `auth.signed_in`;
`session.ended` and `session.removed` → `auth.signed_out`; `session.revoked` →
`auth.session_revoked`. The endpoint (`/api/webhooks/clerk`, already public in the proxy for
exactly this) verifies the Svix signature and timestamp with `CLERK_WEBHOOK_SECRET` before
parsing anything. Each event is written into **every workspace the person belongs to**, and
into no other. Delivery is at-least-once, and one sign-out often arrives as both `ended` and
`removed`. Each (workspace, action, Clerk session) is recorded once, under a transaction-scoped
advisory lock. A sign-in whose webhook beats the browser's first request provisions the person
from the payload, through the same identity derivation as the request path.

What the rows hold: the Clerk session id and event name, and whether the session is an
impersonation. **Not** the client IP or user agent, which Clerk offers. Recording collaborators'
IP addresses where the workspace owner can read them is a privacy decision nobody has made. It
is a one-line change if someone does.

**Failed access** is recorded where a refusal is a meaningful event: workspace settings, member
management, rename, and a workspace selection that names somewhere the person does not belong.
It is not recorded on every scope-level permission check, which would drown the log (see
`auditDecisions` in `packages/authz`).

**Request-time transactions use a direct connection.** Provisioning writes a workspace, a
membership, and an audit row that must commit together (ADR 0006), and the pooled HTTP driver
cannot hold a transaction. `transactionalDatabase()` opens a small (`max: 2`) `pg` pool per
warm instance against `DATABASE_URL_UNPOOLED`. The pooled driver remains the default for
single-statement reads and the `users` upsert.

**Storage usage is cached on the workspace row**, recomputed wholesale from `storage_objects`
when older than ten minutes, and invalidated in the transaction that finalizes an upload. It is
never incremented.

## Consequences

**Easier:** Multi-workspace is additive. Session history exists for every owner without an
admin console. Provisioning cannot produce two workspaces for one person, whatever calls it.

**Harder:** Deploying `031` requires migration `0007` first, and `DATABASE_URL_UNPOOLED` in the
web app's environment. Without them, workspace resolution fails closed and every workspace page
shows "Your workspace isn't available". Session auditing requires a webhook endpoint configured
in Clerk and its signing secret in `CLERK_WEBHOOK_SECRET`. Without the secret the endpoint
answers 503, so Clerk retries rather than events being acknowledged into nothing.

**Accepted:** A person removed from the workspace provisioned for them is **not** given another.
That workspace still holds their provisioning key, so they have nowhere to be, and resolution
fails closed with "Your workspace isn't available" rather than granting anything. Owners cannot
be removed in iteration one; if task `032` makes that possible, it decides what happens. Someone
who never had a provisioned workspace and is removed from every one they joined is provisioned
one on their next request. A stale workspace preference is refused on every request, and the
refusal is recorded at most once an hour per person per workspace. The switcher and the removal
flow (task `032`) are where the preference gets cleared. Unverified webhook requests are
logged, not audited: they have no tenant.

**Member emails** are shown only to someone who may manage members. Everyone else in the
workspace sees names and roles. A collaborator given access to one song should not leave with
the address of everyone the owner works with.

**Authorization is checked before the rename transaction opens**, not inside it, the same as
the upload protocol (task `051`). An owner demoted in the milliseconds between the check and the
write can complete one rename, and it is audited. Closing that window means locking the
membership row inside every audited write, which is a change to all of them, not to this one.

## Alternatives considered

**Provision everyone.** Simpler, but gives every invited collaborator an empty workspace, and
they would land in it whenever it happened to be their oldest membership.

**Infer sign-in from requests.** Needs a table of Clerk session ids already seen, a second
record of something Clerk already records, and still cannot see a sign-out.

**Make `audit_events.workspace_id` nullable for authentication events.** Rejected in task
`030`, for weakening a tenancy invariant across the whole log to accommodate one class of event.
