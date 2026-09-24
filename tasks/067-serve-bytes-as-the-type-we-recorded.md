# 067 — Serve stored bytes as the type we recorded

**Phase:** Media pipeline · **Iteration:** one

## Objective

Make presigned reads return the content type the server determined from the bytes, rather than
whatever the object carries in its own metadata, and never render an original inline.

## User value

None visible. It is what stops a file someone uploaded from executing in another collaborator's
browser.

## Why this exists

Task `051` derives content type from magic bytes and records it on `storage_objects`. That fixes
the **recorded** value. It does not reach what R2 **serves**.

An object's `Content-Type` is set when the multipart upload is created. `051` now mints every
object as `application/octet-stream` rather than the client's hint, which closes the hole in the
safe direction — an original downloads rather than renders. But the correct behaviour is to serve
audio as audio, and that means the read side has to supply the type:

- `StorageDriver.signStream(key)` takes only a key. There is no parameter through which a caller
  could pass a content type, so the correct fix is not expressible at the call site today.
- `signDownload` and `signStream` issue a bare `GetObjectCommand`. Neither sets
  `ResponseContentType`, `ResponseContentDisposition`, nor `X-Content-Type-Options`.

Found in the security review of `051`, which noted that a later reviewer would read
`storage_objects.content_type`, see the sniffed value, and reasonably conclude the control was
already in place.

## Scope

- `signStream` and `signDownload` take the content type the caller read from
  `storage_objects.content_type`, and set `ResponseContentType` on the presigned GET.
- `ResponseContentDisposition: inline` for streaming an audio derivative;
  `attachment` for everything else, including every original.
- Never serve `text/html`, `image/svg+xml`, or anything outside the `packages/media` allowlist
  as a renderable type, whatever the column says.
- A test that a stored object whose bytes are HTML cannot be made to render inline.

## Non-scope

- Re-typing objects already in the bucket. `051`'s objects carry `application/octet-stream` and
  are safe; a backfill is only cosmetic.
- The player (`070`), which consumes this.

## Dependencies

`051`, `062`

## Files expected to change

```
packages/storage/src/driver.ts
packages/storage/src/r2.ts
packages/storage/src/__tests__/**
```

## Security/privacy considerations

`docs/THREAT_MODEL.md` T3. If R2 is ever mapped to a `youandfriends.org` subdomain — the ordinary
reason to use a custom domain — a renderable object served from it is same-site with the
application. The allowlist in `packages/media/src/sniff.ts` is the list of types that may ever be
served as themselves; everything else is an attachment.

## Acceptance criteria

- [x] `signStream` and `signDownload` set `ResponseContentType` from the recorded type. (Both now take `contentType` — `storage_objects.content_type` — alongside the key; `readOverrides` in `packages/storage/src/r2.ts` sets `ResponseContentType` and `ResponseContentDisposition` on every presigned GET. The version download passes the recorded type.)
- [x] Originals are served `attachment`, never `inline`. (`inline` is granted only when streaming, only for a key in the derivative class, and only for an allowlisted type. A key the product did not issue is treated like an original.)
- [x] A type outside the media allowlist is served as `application/octet-stream` regardless of what `storage_objects.content_type` holds. (`servableContentType` in `packages/contracts/src/serving.ts`; parameters and case cannot smuggle a type through. The allowlist lives in contracts so storage and media share it, and a media test holds every audio type the sniffer recognises inside it.)
- [x] A test proves an HTML-bodied object cannot be served renderable. (`packages/storage/src/serving.test.ts` signs reads for `text/html`, `image/svg+xml`, a charset-suffixed HTML type and a missing type, and every URL carries `application/octet-stream` and `attachment`; runs without a server. The MinIO contract suite adds the same case against a real server — it skips loudly here, as MinIO cannot be pulled in this environment.)

**Not settable here.** `X-Content-Type-Options: nosniff` is not among S3's presigned response overrides. `docs/OPERATIONS.md` §1 says how to add it at the bucket's custom domain if one is ever used.

**Manual QA** (streaming a derivative in a browser, downloading an original) was not run: the player arrives with task `070`, and there is no R2 bucket in this environment.

## Tests and validation commands

```bash
pnpm --filter @youandfriends/storage test
pnpm release-check
```

## Manual QA

1. Stream an audio derivative in the browser; confirm it plays.
2. Request an original; confirm it downloads rather than rendering.

## Rollback/compatibility

Additive to the driver signature. Reverting restores download-only behaviour, which is safe but
breaks streaming.

## Status

`complete`

## Commit

_(not yet)_
