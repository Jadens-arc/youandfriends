/**
 * Which content types a stored object may ever be served *as* (task `067`, `docs/THREAT_MODEL.md`
 * T3).
 *
 * `storage_objects.content_type` is what the magic bytes said (task `051`), but the type a
 * browser acts on is the one on the response. A presigned read sets that type explicitly, from
 * this list: an allowlisted type is served as itself, and **everything else is served as
 * `application/octet-stream`**, whatever the column says. HTML, SVG, XML, JavaScript — anything a
 * browser could render and run — is never on it. If the bucket is ever served from a
 * `youandfriends.org` subdomain, a renderable upload would be same-site with the app.
 *
 * Shared by `packages/storage` (which signs) and `packages/media` (whose sniffer's audio types
 * are tested to be a subset), so the two cannot drift.
 */
export const SERVABLE_CONTENT_TYPES = [
  'audio/wav',
  'audio/aiff',
  'audio/flac',
  'audio/x-caf',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  // Browser voice notes (task `093`).
  'audio/webm',
  // Cover renditions (task `069`) — JPEG, produced by the worker. Never SVG.
  'image/jpeg',
] as const;

export const OPAQUE_CONTENT_TYPE = 'application/octet-stream';

/** The type to put on a response: the recorded one when it is allowlisted, otherwise opaque. */
export function servableContentType(recorded: string | null | undefined): string {
  if (recorded === null || recorded === undefined) return OPAQUE_CONTENT_TYPE;
  // Parameters (`; charset=…`) and case are not allowed to smuggle a type past the list.
  const bare = recorded.split(';')[0]?.trim().toLowerCase() ?? '';
  return (SERVABLE_CONTENT_TYPES as readonly string[]).includes(bare) ? bare : OPAQUE_CONTENT_TYPE;
}
