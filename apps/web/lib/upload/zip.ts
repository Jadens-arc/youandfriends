import { Zip, ZipPassThrough } from 'fflate';

import { HASH_SLICE_BYTES, readSlice } from './hash';
import type { FolderReview } from './manifest';

/**
 * Zipping a modest folder in the browser (task `054`).
 *
 * **Stored, not deflated.** The folders this is for are audio sessions: WAVs and AIFFs do not
 * compress meaningfully, and deflating a few hundred megabytes on the page's thread would freeze
 * it for no gain. Store mode is a copy with headers.
 *
 * Only included files go in, under their normalized paths. The server never opens the archive —
 * it is stored and checksummed, never expanded (`docs/THREAT_MODEL.md` T4), which removes the
 * ZIP-bomb class entirely. The archive is built as a `Blob` of chunks so the browser may keep it
 * off the JavaScript heap.
 */
export async function zipFolder(
  review: FolderReview,
  onProgress: (zippedBytes: number) => void = () => {},
): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let finished!: () => void;
  let failed!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    finished = resolve;
    failed = reject;
  });

  const zip = new Zip((error, chunk, final) => {
    if (error !== null) {
      failed(error);
      return;
    }
    chunks.push(new Uint8Array(chunk));
    if (final) finished();
  });

  let zipped = 0;
  for (const file of review.files) {
    if (file.status !== 'included' || file.path === null) continue;
    const entry = new ZipPassThrough(file.path);
    entry.mtime = file.source.file.lastModified || Date.now();
    zip.add(entry);
    // Slice by slice, so one large file is never in memory whole.
    const source = file.source.file;
    for (let offset = 0; offset < source.size; offset += HASH_SLICE_BYTES) {
      const slice = source.slice(offset, Math.min(offset + HASH_SLICE_BYTES, source.size));
      const value = new Uint8Array(await readSlice(slice));
      entry.push(value);
      zipped += value.byteLength;
      onProgress(zipped);
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  await done;
  return new Blob(chunks, { type: 'application/zip' });
}
