'use client';

import { Button } from '@youandfriends/ui';
import { Upload } from 'lucide-react';
import * as React from 'react';

import { uploadQueue, type UploadQueue } from '@/lib/upload/store';

/** What the file picker offers. The server decides what the bytes really are. */
export const AUDIO_ACCEPT = 'audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.aac';

/**
 * "Upload new version" (task `056`): pick a mix and hand it to the upload queue (task `055`),
 * whose tray shows progress, pause, and retry across route changes. The finished upload is
 * recorded as the song's newest mix, which becomes current automatically.
 */
export function UploadVersion({
  songId,
  songTitle,
  queue = uploadQueue(),
}: {
  readonly songId: string;
  readonly songTitle: string;
  readonly queue?: UploadQueue;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          queue.add([file], { type: 'mix', songId, label: `${songTitle} (new version)` });
        }}
      />
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
        <Upload aria-hidden />
        Upload new version
      </Button>
    </>
  );
}
