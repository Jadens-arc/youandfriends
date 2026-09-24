import type { UploadedPart } from '@youandfriends/storage';

/**
 * Where an in-flight upload remembers itself, so a reload resumes rather than restarts
 * (task `053`).
 *
 * **What is stored, and what is not.** The session id, the part size, the parts already
 * confirmed (number, ETag, size), and the checksum. Never a presigned URL: those are bearer
 * credentials with a fifteen-minute life, and IndexedDB is on disk for as long as the browser
 * keeps it (`docs/THREAT_MODEL.md` T3). A resumed upload asks for fresh URLs.
 *
 * The file itself is not stored either — the browser cannot hand a page back a file it was
 * given in an earlier load without copying it, and copying a 2 GB master into site storage is
 * the wrong trade. Resuming asks for the same file again and matches it by
 * {@link uploadFingerprint}.
 */

export interface PersistedUpload {
  readonly fingerprint: string;
  readonly sessionId: string;
  readonly assetId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly lastModified: number;
  readonly partSizeBytes: number;
  readonly checksumSha256: string;
  readonly parts: readonly UploadedPart[];
  /** ISO timestamp. A record past it is useless — the server session has expired. */
  readonly expiresAt: string;
}

export interface UploadStore {
  get(fingerprint: string): Promise<PersistedUpload | null>;
  put(record: PersistedUpload): Promise<void>;
  delete(fingerprint: string): Promise<void>;
  list(): Promise<PersistedUpload[]>;
}

/**
 * The same file for the same destination. Name, size and modification time together are what
 * the browser can tell us without reading the bytes; a changed file changes at least one.
 */
export function uploadFingerprint(
  assetId: string,
  file: { readonly name: string; readonly size: number; readonly lastModified: number },
): string {
  return JSON.stringify([assetId, file.name, file.size, file.lastModified]);
}

/** Refuses to persist anything that looks like a URL — the guard behind the rule above. */
export function assertNoCredentials(record: PersistedUpload): void {
  if (/https?:\/\//i.test(JSON.stringify(record))) {
    throw new Error('refusing to persist a URL in upload state');
  }
}

const DB_NAME = 'youandfriends-uploads';
const STORE = 'sessions';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'fingerprint' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open upload store'));
  });
}

function run<T>(
  database: Promise<IDBDatabase>,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return database.then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error ?? new Error('upload store failed'));
      }),
  );
}

export function indexedDbUploadStore(factory: IDBFactory = indexedDB): UploadStore {
  const database = open(factory);
  return {
    get: async (fingerprint) =>
      ((await run(database, 'readonly', (store) => store.get(fingerprint))) as
        PersistedUpload | undefined) ?? null,
    put: async (record) => {
      assertNoCredentials(record);
      await run(database, 'readwrite', (store) => store.put(record));
    },
    delete: async (fingerprint) => {
      await run(database, 'readwrite', (store) => store.delete(fingerprint));
    },
    list: async () =>
      (await run(database, 'readonly', (store) => store.getAll())) as PersistedUpload[],
  };
}

/** For environments with no IndexedDB (private modes that disable it): resumable in-page only. */
export function memoryUploadStore(): UploadStore {
  const records = new Map<string, PersistedUpload>();
  return {
    get: async (fingerprint) => records.get(fingerprint) ?? null,
    put: async (record) => {
      assertNoCredentials(record);
      records.set(record.fingerprint, record);
    },
    delete: async (fingerprint) => {
      records.delete(fingerprint);
    },
    list: async () => [...records.values()],
  };
}
