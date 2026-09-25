import { tierForWidth, type DecodedTier } from './tier';

export type { DecodedTier } from './tier';

/**
 * Fetching and decoding a version's waveform (task `072`).
 *
 * Bytes are fetched once per version and kept in memory for the session — they are small, and
 * the same waveform is drawn at several widths (the song page, the expanded player). Decoding
 * runs in a worker where the browser has one, and on the main thread only where it does not
 * (tests, very old engines).
 */
export type WaveformResult =
  | { readonly ok: true; readonly tier: DecodedTier }
  | { readonly ok: false; readonly reason: 'not_ready' | 'unauthorized' | 'unavailable' | 'error' };

const bytesCache = new Map<string, Promise<ArrayBuffer | WaveformResult>>();

async function fetchPeaks(versionId: string): Promise<ArrayBuffer | WaveformResult> {
  let response: Response;
  try {
    response = await fetch(`/api/versions/${encodeURIComponent(versionId)}/waveform`, {
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (response.status === 409) return { ok: false, reason: 'not_ready' };
  if (response.status === 404 || response.status === 401)
    return { ok: false, reason: 'unauthorized' };
  if (response.status === 503) return { ok: false, reason: 'unavailable' };
  if (!response.ok) return { ok: false, reason: 'error' };
  return response.arrayBuffer();
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (tier: DecodedTier) => void; reject: (error: Error) => void }
>();

function decoder(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') {
    worker = null;
    return worker;
  }
  try {
    worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      event: MessageEvent<{ id: number; tier?: DecodedTier; error?: string }>,
    ) => {
      const waiting = pending.get(event.data.id);
      if (waiting === undefined) return;
      pending.delete(event.data.id);
      if (event.data.tier !== undefined) waiting.resolve(event.data.tier);
      else waiting.reject(new Error(event.data.error ?? 'could not decode'));
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function decodeTier(bytes: ArrayBuffer, widthPx: number): Promise<DecodedTier> {
  const target = decoder();
  if (target === null) return Promise.resolve(tierForWidth(new Uint8Array(bytes), widthPx));
  nextId += 1;
  const id = nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // A copy goes to the worker; the cached original stays usable for the next width.
    target.postMessage({ id, bytes: bytes.slice(0), widthPx });
  });
}

export async function loadWaveform(versionId: string, widthPx: number): Promise<WaveformResult> {
  let cached = bytesCache.get(versionId);
  if (cached === undefined) {
    cached = fetchPeaks(versionId);
    bytesCache.set(versionId, cached);
  }
  const bytes = await cached;
  if (!(bytes instanceof ArrayBuffer)) {
    // Not cached as a failure: a version still processing will have peaks soon.
    bytesCache.delete(versionId);
    return bytes;
  }
  try {
    return { ok: true, tier: await decodeTier(bytes, widthPx) };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** For tests. */
export function clearWaveformCache(): void {
  bytesCache.clear();
}
