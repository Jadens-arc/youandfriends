'use client';

import { Button } from '@youandfriends/ui';
import { ImageUp } from 'lucide-react';
import * as React from 'react';

import { postJson } from '@/lib/api/client';
import { uploadQueue, type UploadQueue } from '@/lib/upload/store';

export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/heic,.png,.jpg,.jpeg,.webp,.heic';

/**
 * "Set cover" (task `043`): the image goes through the standard upload path (task `055`) as the
 * project's artwork, and once its version is recorded the project points at it. Sized renditions
 * for display are task `069`; the original is never served into a grid.
 */
export function CoverUpload({
  projectId,
  projectName,
  queue = uploadQueue(),
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly queue?: UploadQueue;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          queue.add(
            [file],
            {
              type: 'asset',
              owner: { projectId },
              kind: 'artwork',
              label: `${projectName} · Cover`,
            },
            {
              onRecorded: (assetId) =>
                postJson(
                  `/api/projects/${encodeURIComponent(projectId)}`,
                  { coverAssetId: assetId },
                  'PATCH',
                ),
            },
          );
        }}
      />
      <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
        <ImageUp aria-hidden />
        Set cover
      </Button>
    </>
  );
}
