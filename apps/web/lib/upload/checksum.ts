import { hashBlob, type ChecksumRequest, type ChecksumResponse, type HashProgress } from './hash';

export { HASH_SLICE_BYTES, hashBlob, type HashProgress } from './hash';

/**
 * Hashing in a Web Worker (task `053`), so the main thread never does this work: a tab frozen for
 * twenty seconds during a long upload reads as a crash. The hash itself is `hash.ts`.
 */
export type Hasher = (file: Blob, onProgress: HashProgress, signal: AbortSignal) => Promise<string>;

/**
 * Hash in a Web Worker. Terminating the worker is how a cancel stops the work — there is no
 * other way to interrupt a loop running on another thread.
 */
export const workerHasher: Hasher = (file, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      // No workers (an old embedded browser): hash here, slice by slice, awaiting each read so
      // the page still gets turns in between. Slower to the eye, never frozen solid.
      hashBlob(file, onProgress, signal).then(resolve, reject);
      return;
    }
    const worker = new Worker(new URL('./checksum.worker.ts', import.meta.url), {
      type: 'module',
    });
    const stop = () => {
      worker.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
    worker.onmessage = (event: MessageEvent<ChecksumResponse>) => {
      const message = event.data;
      if (message.type === 'progress') onProgress(message.hashedBytes);
      else {
        signal.removeEventListener('abort', stop);
        worker.terminate();
        if (message.type === 'done') resolve(message.checksum);
        else reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
      reject(new Error(event.message || 'The checksum worker failed.'));
    };
    worker.postMessage({ type: 'hash', file } satisfies ChecksumRequest);
  });
