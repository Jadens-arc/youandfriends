/// <reference lib="webworker" />

import { hashBlob, type ChecksumRequest, type ChecksumResponse } from './checksum';

/**
 * The checksum worker (task `053`). Hashes off the main thread and reports progress at most a
 * few times a second, so the page's progress bar moves without the messages themselves becoming
 * the load.
 */
declare const self: DedicatedWorkerGlobalScope;

const PROGRESS_INTERVAL_MS = 150;

self.onmessage = async (event: MessageEvent<ChecksumRequest>) => {
  const post = (message: ChecksumResponse) => self.postMessage(message);
  let last = 0;
  try {
    const checksum = await hashBlob(event.data.file, (hashedBytes) => {
      const now = Date.now();
      if (now - last >= PROGRESS_INTERVAL_MS) {
        last = now;
        post({ type: 'progress', hashedBytes });
      }
    });
    post({ type: 'done', checksum });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'hashing failed' });
  }
};
