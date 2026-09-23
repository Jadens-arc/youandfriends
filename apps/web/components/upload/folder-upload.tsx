'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@youandfriends/ui';
import { FolderUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { folderFromFileList } from '@/lib/upload/folder';
import { reviewFolder, type FolderReview as FolderReviewData } from '@/lib/upload/manifest';
import { uploadFolderSnapshot, type SnapshotStage } from '@/lib/upload/snapshot';
import { formatBytes } from '@/lib/songs/format';

import { FolderReview } from './folder-review';

function describeStage(stage: SnapshotStage): string {
  switch (stage.stage) {
    case 'hashing':
      return `Checking files… ${formatBytes(stage.doneBytes)} of ${formatBytes(stage.totalBytes)}`;
    case 'recording':
      return 'Recording the manifest…';
    case 'zipping':
      return `Zipping… ${formatBytes(stage.doneBytes)} of ${formatBytes(stage.totalBytes)}`;
    case 'uploading': {
      const progress = stage.uploader.progress();
      return `Uploading ${formatBytes(progress.uploadedBytes)} of ${formatBytes(progress.totalBytes)}`;
    }
    case 'sealing':
      return 'Sealing the snapshot…';
    case 'done':
      return 'Uploaded.';
  }
}

/**
 * "Upload folder" (task `054`): pick a folder, review it, and send it as one sealed snapshot.
 * The folder picker is a real `<input webkitdirectory>` behind a button, so it works from the
 * keyboard and is announced as a file control.
 */
export function FolderUpload({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [review, setReview] = React.useState<FolderReviewData | null>(null);
  const [stage, setStage] = React.useState<SnapshotStage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [, force] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (stage?.stage !== 'uploading') return;
    return stage.uploader.subscribe(() => force());
  }, [stage]);

  async function confirm() {
    if (review === null) return;
    setError(null);
    try {
      await uploadFolderSnapshot(projectId, review, setStage);
      setReview(null);
      setStage(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The folder upload failed.');
      setStage(null);
    }
  }

  const busy = stage !== null && stage.stage !== 'done';

  return (
    <>
      <input
        ref={input}
        type="file"
        // `webkitdirectory` is not in React's attribute types; set as a plain attribute.
        {...{ webkitdirectory: '', directory: '' }}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = event.target.files;
          if (files !== null && files.length > 0)
            setReview(reviewFolder(folderFromFileList(files)));
          event.target.value = '';
        }}
      />
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
        <FolderUp aria-hidden />
        Upload folder
      </Button>
      <Dialog
        open={review !== null}
        onOpenChange={(open) => (!open && !busy ? setReview(null) : undefined)}
      >
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">Review folder upload</DialogTitle>
          <DialogDescription className="sr-only">
            Check what will be uploaded and what will be left out.
          </DialogDescription>
          {review === null ? null : (
            <FolderReview
              review={review}
              busy={busy}
              onConfirm={() => void confirm()}
              onCancel={() => setReview(null)}
            />
          )}
          {stage === null ? null : (
            <p aria-live="polite" className="text-caption text-muted-foreground font-sans">
              {describeStage(stage)}
            </p>
          )}
          {error === null ? null : (
            <p role="alert" className="text-caption text-destructive font-sans">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
