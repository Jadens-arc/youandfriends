# ADR 0008: operational scripts compose packages that the libraries may not import

- **Status:** accepted
- **Date:** 2026-09-18
- **Task:** 051

## Context

`docs/ARCHITECTURE.md` §3 fixes the dependency direction: `@youandfriends/db` may import
`contracts` and `config`, and nothing else. `storage` may not import `db`, and `db` may not
import `storage`. That rule is what keeps the schema package usable from a migration runner, a
job worker and a serverless function alike, without dragging an S3 client into any of them.

Two operational jobs need both halves anyway:

- **The expired-upload sweep** (this task) reads `upload_sessions` and must abort the
  corresponding multipart uploads in R2. Incomplete multipart parts are billed and invisible;
  a sweep that only marks rows makes the leak permanent rather than fixing it.
- **The purge job** (task `028`) deletes rows and must delete the storage objects they point
  at. It currently refuses to run when its plan names any storage object, precisely because it
  has no way to reach a driver — `bin/purge.mjs` says so in its header.

`docs/OPERATIONS.md` §2 already specifies the command as
`pnpm --filter @youandfriends/db ops:uploads:sweep`, so the entry point lives in the `db`
package by prior decision.

Three options were considered. Relaxing the rule so `db` imports `storage` outright would put an
S3 client on the critical path of every consumer of the schema, which is the thing the rule
exists to prevent. Moving the scripts into `apps/web` would give operational tooling a
dependency on a Next.js application, and contradicts the documented command. Inverting the
dependency — passing the capability in — is what the library code already does: `executePurge`
takes an `ObjectReaper | null` and `executeUploadSweep` takes a `MultipartAborter | null`.

## Decision

**Library code keeps the rule. Entry points may compose.**

- `packages/db/src/**` imports `contracts` and `config` only, unchanged. The sweep and purge
  modules take the storage capability as an injected function and never import a driver.
- `packages/db/bin/*.mjs` — scripts, not library modules — may import `@youandfriends/storage`
  to construct that function. `@youandfriends/storage` is a **devDependency** of
  `@youandfriends/db`, so it is absent from any production install that consumes the package as
  a library, and present for the operator running the job.
- A plan that needs the capability and was not given one **throws** rather than proceeding. This
  is already how both jobs behave, and it is the property that makes the injection safe: there
  is no silent half-run that marks rows while leaving objects behind.

The distinction is that a `bin/` script is a composition root. It is allowed to know about both
sides because knowing about both sides is its entire job; the modules it calls still cannot.

## Consequences

- The sweep can actually reclaim storage, which is the only reason it exists.
- `bin/purge.mjs` can be given a real reaper by the task that owns it. This ADR opens that door
  but does not walk through it — purge's storage deletion stays refused until a task wires and
  tests it, because a purge that deletes the wrong objects is unrecoverable.
- A future package that needs both `db` and `storage` in _library_ code is a signal to add a
  composition package, not to relax this again.
- The rule stays mechanically checkable: the check is on `src/`, and `bin/` is excluded by path.
