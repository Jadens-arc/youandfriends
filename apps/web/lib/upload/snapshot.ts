import type { ManifestEntry } from '@youandfriends/contracts';

import { browserUploader } from './browser';
import { workerHasher } from './checksum';
import { buildManifest, type FolderReview } from './manifest';
import type { MultipartUploader } from './uploader';
import { zipFolder } from './zip';

/**
 * A reviewed folder, end to end (task `054`): checksum each included file, record the manifest,
 * zip in the browser, upload the ZIP through the ordinary multipart path, and seal the snapshot.
 *
 * Every step reports what it is doing, because a folder upload is long and "working…" for four
 * minutes is how people decide an app has hung.
 */

export type SnapshotStage =
  | { readonly stage: 'hashing'; readonly doneBytes: number; readonly totalBytes: number }
  | { readonly stage: 'recording' }
  | { readonly stage: 'zipping'; readonly doneBytes: number; readonly totalBytes: number }
  | { readonly stage: 'uploading'; readonly uploader: MultipartUploader }
  | { readonly stage: 'sealing' }
  | { readonly stage: 'done'; readonly snapshotId: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? 'The folder upload failed. Try again.');
  }
  return (await response.json()) as T;
}

export async function uploadFolderSnapshot(
  projectId: string,
  review: FolderReview,
  onStage: (stage: SnapshotStage) => void,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  if (!review.zipInBrowser) {
    throw new Error('This folder is too large to zip in the browser. Use the Mac app instead.');
  }

  const totalBytes = review.includedBytes;
  onStage({ stage: 'hashing', doneBytes: 0, totalBytes });
  const entries: ManifestEntry[] = await buildManifest(
    review,
    (file, onProgress) => workerHasher(file, onProgress, signal),
    (doneBytes) => onStage({ stage: 'hashing', doneBytes, totalBytes }),
  );

  onStage({ stage: 'recording' });
  const { snapshotId, assetId } = await postJson<{ snapshotId: string; assetId: string }>(
    '/api/snapshots',
    { projectId, name: review.name, entries },
  );

  onStage({ stage: 'zipping', doneBytes: 0, totalBytes });
  const zip = await zipFolder(review, (doneBytes) =>
    onStage({ stage: 'zipping', doneBytes, totalBytes }),
  );

  const uploader = browserUploader({
    assetId,
    file: new File([zip], `${review.name}.zip`, { type: 'application/zip' }),
    contentTypeHint: 'application/zip',
  });
  onStage({ stage: 'uploading', uploader });
  const result = await uploader.start();
  if (result === null || uploader.session === null) {
    throw new Error(uploader.progress().error ?? 'The upload stopped before it finished.');
  }

  onStage({ stage: 'sealing' });
  await postJson(`/api/snapshots/${encodeURIComponent(snapshotId)}/finalize`, {
    sessionId: uploader.session,
  });
  onStage({ stage: 'done', snapshotId });
  return snapshotId;
}
