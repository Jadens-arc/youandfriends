import type { PlayerErrorKind } from './machine';

/**
 * Asking the server for a stream URL (task `070`), from the browser.
 *
 * The URL lives in memory only — the player's controller holds it for as long as it is valid and
 * no longer. It is never written to `localStorage`, `sessionStorage`, IndexedDB, or a log: it is
 * a bearer credential for someone's unreleased mix (`docs/THREAT_MODEL.md` T3).
 */
export interface StreamUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

export type StreamUrlResult =
  | { readonly ok: true; readonly grant: StreamUrl }
  | { readonly ok: false; readonly kind: PlayerErrorKind };

export type FetchStreamUrl = (versionId: string) => Promise<StreamUrlResult>;

export const fetchStreamUrl: FetchStreamUrl = async (versionId) => {
  let response: Response;
  try {
    response = await fetch(`/api/stream/${encodeURIComponent(versionId)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, kind: 'network' };
  }
  // 404 is what every refusal looks like, including access revoked mid-song.
  if (response.status === 404 || response.status === 401)
    return { ok: false, kind: 'unauthorized' };
  if (response.status === 409) return { ok: false, kind: 'not_ready' };
  if (response.status === 503) return { ok: false, kind: 'unavailable' };
  if (!response.ok) return { ok: false, kind: 'network' };
  const body = (await response.json()) as { url?: unknown; expiresAt?: unknown };
  if (typeof body.url !== 'string' || typeof body.expiresAt !== 'string') {
    return { ok: false, kind: 'network' };
  }
  return { ok: true, grant: { url: body.url, expiresAt: new Date(body.expiresAt) } };
};
