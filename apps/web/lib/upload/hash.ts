import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * SHA-256 of a file, incrementally (task `053`).
 *
 * `crypto.subtle.digest` needs the whole input in memory at once, which for a 2 GB master is a
 * 2 GB `ArrayBuffer` — the tab dies. This reads the file a slice at a time and feeds an
 * incremental hash, so memory stays flat whatever the size.
 *
 * Its own module, with no reference to the worker, because the worker imports it: a module that
 * both creates the worker and is imported by it is an import cycle through `new URL(…)`, and the
 * bundler follows it forever.
 */

/** 8 MiB: large enough that per-slice overhead is noise, small enough to stay flat in memory. */
export const HASH_SLICE_BYTES = 8 * 1024 * 1024;

export type HashProgress = (hashedBytes: number) => void;

/** `Blob.arrayBuffer`, with `FileReader` for the engines (and test DOMs) that lack it. */
export function readSlice(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function hashBlob(
  blob: Blob,
  onProgress: HashProgress = () => {},
  signal?: AbortSignal,
): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < blob.size; offset += HASH_SLICE_BYTES) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const slice = blob.slice(offset, Math.min(offset + HASH_SLICE_BYTES, blob.size));
    hash.update(new Uint8Array(await readSlice(slice)));
    onProgress(Math.min(offset + HASH_SLICE_BYTES, blob.size));
  }
  return bytesToHex(hash.digest());
}

/** The message protocol between the page and the worker. */
export type ChecksumRequest = { readonly type: 'hash'; readonly file: Blob };
export type ChecksumResponse =
  | { readonly type: 'progress'; readonly hashedBytes: number }
  | { readonly type: 'done'; readonly checksum: string }
  | { readonly type: 'error'; readonly message: string };
