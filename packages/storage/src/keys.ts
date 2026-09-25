import { isUlid, newUlid } from '@youandfriends/contracts';

/**
 * Object keys.
 *
 * **A user path never becomes a key.** Keys are opaque and server-generated, which closes path
 * traversal, information disclosure through the key name, and collision in one move
 * (`docs/THREAT_MODEL.md` T3 and T4). A key built from a filename leaks the filename to anyone
 * who sees a presigned URL — including the browser history of whoever the link was forwarded
 * to — and "Unreleased - Blue Hour final FINAL.wav" is exactly the kind of thing this product
 * exists not to leak.
 *
 * The workspace is a prefix so a bucket listing is readable by tenant and a lifecycle rule can
 * be scoped to one, but it is **not** a security boundary: authorization happens before a URL
 * is ever signed, and the prefix is a convenience for operators.
 */

/** What a key holds. Prefixes are separate so lifecycle rules can differ per class. */
export const OBJECT_CLASSES = {
  /** Uploaded bytes. Never overwritten, never purged by a lifecycle rule. */
  original: 'o',
  /** Regenerable renditions. A lifecycle rule may purge these aggressively. */
  derivative: 'd',
  /** Folder snapshot ZIPs. */
  snapshot: 's',
} as const;

export type ObjectClass = keyof typeof OBJECT_CLASSES;

/**
 * A new opaque key for a workspace.
 *
 * `w/<workspaceId>/<class>/<ulid>` — every segment server-generated. The ULID is the object's
 * identity, and it is what `storage_objects.key` records.
 */
export function newObjectKey(workspaceId: string, objectClass: ObjectClass): string {
  return `w/${workspaceId}/${OBJECT_CLASSES[objectClass]}/${newUlid()}`;
}

/**
 * The key of one derivative row's object: `w/<workspaceId>/d/<derivativeId>` (task `064`).
 *
 * Deterministic where {@link newObjectKey} is random, and only for derivatives. A media job that
 * uploads and then dies before recording what it uploaded must, on retry, write the *same* key —
 * a fresh one each attempt would leave an unreferenced object behind for every failure. The
 * derivative row's id is stable across retries (one row per version, kind and variant), so it
 * names the object. Still opaque: the id is a server-generated ULID, never a user value.
 */
export function derivativeObjectKey(workspaceId: string, derivativeId: string): string {
  if (!isUlid(derivativeId)) throw new Error(`derivative id ${derivativeId} is not a ULID`);
  return `w/${workspaceId}/${OBJECT_CLASSES.derivative}/${derivativeId}`;
}

/** The prefix covering everything a workspace owns, for a listing or a lifecycle rule. */
export function workspacePrefix(workspaceId: string): string {
  return `w/${workspaceId}/`;
}

/** The prefix covering one class within a workspace. */
export function classPrefix(workspaceId: string, objectClass: ObjectClass): string {
  return `w/${workspaceId}/${OBJECT_CLASSES[objectClass]}/`;
}

/** A key's parts, or `null` when it is not one of ours. Used by reconciliation, never to authorize. */
export function parseObjectKey(
  key: string,
): { workspaceId: string; objectClass: ObjectClass; id: string } | null {
  const parts = key.split('/');
  if (parts.length !== 4) return null;
  const [w, workspaceId, prefix, id] = parts;
  if (w !== 'w' || workspaceId === undefined || prefix === undefined || id === undefined) {
    return null;
  }
  if (workspaceId === '' || id === '') return null;

  const entry = Object.entries(OBJECT_CLASSES).find(([, value]) => value === prefix);
  if (entry === undefined) return null;

  return { workspaceId, objectClass: entry[0] as ObjectClass, id };
}
