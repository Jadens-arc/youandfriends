import { httpUploadApi, xhrPartTransport } from './api';
import { workerHasher } from './checksum';
import { indexedDbUploadStore, memoryUploadStore, type UploadStore } from './persistence';
import { MultipartUploader, type UploadTarget } from './uploader';

/**
 * The uploader wired to the real endpoints, the real part transport, the checksum worker, and
 * IndexedDB — what a component constructs. Falls back to in-page state when IndexedDB is
 * unavailable (some private modes), which loses only resume-after-reload.
 */
let store: UploadStore | null = null;

function uploadStore(): UploadStore {
  if (store === null) {
    store = typeof indexedDB === 'undefined' ? memoryUploadStore() : indexedDbUploadStore();
  }
  return store;
}

export function browserUploader(target: UploadTarget): MultipartUploader {
  return new MultipartUploader(target, {
    api: httpUploadApi(),
    transport: xhrPartTransport,
    hasher: workerHasher,
    store: uploadStore(),
  });
}
