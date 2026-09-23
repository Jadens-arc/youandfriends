# 058 — Upload HTTP endpoints

**Phase:** Upload, storage, versions · **Iteration:** one

## Objective

Expose the upload protocol implemented in task `051` over HTTP: the four routes under
`apps/web/app/api/uploads/**`, with request validation, authentication, workspace resolution,
and error mapping.

## User value

The browser and the macOS agent can actually reach the upload protocol. Until this lands, the
protocol is correct and tested but unreachable from outside the server process.

## Why this is a separate task

Split out of `051` **before coding**, per CLAUDE.md §3, because the endpoints depend on work
that is not complete:

- A route must turn a request into `{ userId, workspaceId }`. `apps/web/lib/auth/session.ts`
  resolves a Clerk identity to `{ subject, userId }` (task `030`) but there is no workspace
  resolution — that is task `031`, which is `pending`.
- Choosing how a request names its workspace is a product decision with consequences for URLs,
  the macOS agent, and share links. Inventing one here would commit the product to it by
  accident and force `031` to undo it.

`051` therefore delivers the protocol — session creation, part signing, finalize, abort, the
expiry sweep, magic-byte content typing and the audit trail — as a tested service layer, and
this task puts HTTP in front of it. Nothing in `051` is a stub: `apps/web/lib/uploads/service.ts`
is the real implementation and this task adds no upload logic, only transport.

## Scope

- `POST /api/uploads` — validate, resolve the session and workspace, call `createUploadSession`.
- `POST /api/uploads/:id/parts` — call `signUploadParts`.
- `POST /api/uploads/:id/complete` — call `completeUploadSession`.
- `POST /api/uploads/:id/abort` — call `abortUploadSession`.
- Zod validation at the boundary, on the parsed body, before anything else.
- Error mapping from `UploadError` codes to status codes. **`not_found` and every
  authorization refusal map to 404**, never 403 (`docs/THREAT_MODEL.md` T1).
- A correlation id per request, passed into `UploadContext.correlationId` so the audit rows
  join to the structured logs.

## Non-scope

- The upload protocol itself (task `051`, complete).
- The client uploader (task `053`).
- Workspace provisioning (task `031`), which this task consumes rather than defines.

## Dependencies

`051`, `031`, `030`

## Files expected to change

```
apps/web/app/api/uploads/route.ts
apps/web/app/api/uploads/[id]/parts/route.ts
apps/web/app/api/uploads/[id]/complete/route.ts
apps/web/app/api/uploads/[id]/abort/route.ts
apps/web/app/api/uploads/__tests__/**
```

## Implementation notes

- `apps/web/AGENTS.md` applies: this Next.js version is not the one in training data, and the
  route conventions must be read from `node_modules/next/dist/docs/` before writing handlers.
- The service layer takes its collaborators by injection (`db`, `driver`, `authz`, clock, ids).
  A route builds that context; it does not reach for globals, and it does not re-implement any
  check the service already makes.
- Never echo the object key or an upload id in a response. The client is told a session id, a
  part size and a part count, and nothing about where its bytes are going.

## Security/privacy considerations

`docs/THREAT_MODEL.md` T4 and T1. The protocol's controls live in `051` and are tested there;
what this task must not do is undermine them — by reading a key from the body, by returning a
403 that confirms a resource exists, by logging a presigned URL, or by constructing an
`UploadContext` whose `workspaceId` came from anywhere but the resolved session.

## Acceptance criteria

- [x] All four routes exist and call the service layer without duplicating its checks. (`app/api/uploads/route.ts`, `[id]/parts`, `[id]/complete`, `[id]/abort`; each parses, resolves the workspace, and calls one service function. Shared transport in `lib/api/http.ts` and `lib/uploads/http.ts`.)
- [x] A request from a signed-out caller is refused. (`lib/uploads/__tests__/routes.test.ts`: 401, and the driver is never called. The proxy's `auth.protect()` refuses first in production.)
- [x] A malformed body is rejected by Zod before any database or storage call. (Same file: non-JSON, a negative size, a bad asset id, and a part number of 0 are 422 with zero workspace lookups and zero driver calls.)
- [x] An `UploadError` maps to the documented status code, and no refusal returns 403. (`UPLOAD_ERROR_STATUS`: not_found/forbidden 404, expired 410, size/part-count 413, object_missing and invalid_state 409, checksum_mismatch 422; an unconfigured bucket is an honest 503. Expired, finished, and cross-tenant cases are exercised.)
- [x] No response body contains an object key, an upload id, or a presigned URL beyond the part URLs the caller asked for. (Asserted against the real session row's key and provider upload id.)
- [x] A cross-workspace session id returns 404. (Sign, complete, and abort on another tenant's session; creation against another tenant's asset.)

The route tests live in `apps/web/lib/uploads/__tests__/routes.test.ts` rather than under `app/api`: the `no-unscoped-db` lint rule covers everything under `app/api`, and the Clerk webhook route's tests already live under `lib/` for the same reason.

Manual QA against MinIO was not run in this environment: the pinned MinIO image cannot be pulled here (the registry is blocked by the network policy), so the end-to-end check through a real S3 server is still owed. The service and routes are exercised end to end against a real Postgres with the recording driver.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm release-check
```

## Manual QA

1. Upload a file end to end through the real endpoints against MinIO; confirm a version exists.
2. Replay the complete call; confirm the same version and no duplicate.
3. Call an endpoint signed out; confirm the refusal.

## Rollback/compatibility

Additive. Reverting removes the HTTP surface but leaves the protocol intact.

## Status

`complete`

## Commit

_(not yet)_
