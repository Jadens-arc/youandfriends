'use client';

import { Button } from '@youandfriends/ui';
import { Pause, Play, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { browserUploader } from '@/lib/upload/browser';
import type { MultipartUploader, UploadProgress } from '@/lib/upload/uploader';
import { formatBytes } from '@/lib/songs/format';

/** What the file picker offers. The server decides what the bytes really are. */
export const AUDIO_ACCEPT = 'audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.aac';

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? 'Something went wrong. Try again.');
  }
  return (await response.json()) as T;
}

function statusLine(progress: UploadProgress): string {
  switch (progress.state) {
    case 'hashing':
      return `Preparing… ${formatBytes(progress.hashedBytes)} of ${formatBytes(progress.totalBytes)}`;
    case 'uploading':
      return `Uploading ${formatBytes(progress.uploadedBytes)} of ${formatBytes(progress.totalBytes)}`;
    case 'paused':
      return `Paused at ${formatBytes(progress.uploadedBytes)} of ${formatBytes(progress.totalBytes)}`;
    case 'completing':
      return 'Finishing…';
    case 'completed':
      return 'Uploaded';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return progress.error ?? 'The upload failed.';
    case 'idle':
      return 'Starting…';
  }
}

/**
 * "Upload new version" (task `056`): pick a file, send it through the multipart uploader
 * (task `053`), and record it as the song's newest mix — which becomes current automatically.
 *
 * Compact on purpose: the full upload surface, with queues and folder uploads, is task `055`.
 * Progress is a real `progressbar` with a text alternative, and pause, resume, and cancel are
 * ordinary buttons.
 */
export function UploadVersion({ songId }: { readonly songId: string }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [upload, setUpload] = React.useState<MultipartUploader | null>(null);
  const [progress, setProgress] = React.useState<UploadProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function begin(file: File) {
    setError(null);
    try {
      const { assetId } = await postJson<{ assetId: string }>(
        `/api/songs/${encodeURIComponent(songId)}/versions/prepare`,
      );
      const uploader = browserUploader({ assetId, file });
      setUpload(uploader);
      uploader.subscribe(setProgress);
      await finish(uploader, uploader.start());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The upload failed.');
    }
  }

  async function finish(uploader: MultipartUploader, run: Promise<unknown>) {
    const result = await run;
    if (result === null || uploader.session === null) return;
    await postJson(`/api/songs/${encodeURIComponent(songId)}/versions`, {
      sessionId: uploader.session,
    });
    setUpload(null);
    setProgress(null);
    router.refresh();
  }

  const active = progress !== null && !['completed', 'cancelled'].includes(progress.state);
  const percent =
    progress === null || progress.totalBytes === 0
      ? 0
      : Math.round((progress.uploadedBytes / progress.totalBytes) * 100);

  return (
    <div className="flex flex-col gap-2">
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
          if (file !== undefined) void begin(file);
        }}
      />
      {active && upload !== null && progress !== null ? (
        <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-3">
          <div
            role="progressbar"
            aria-label="Uploading new version"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={statusLine(progress)}
            className="bg-border-subtle h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-muted-foreground font-sans" aria-live="polite">
              {statusLine(progress)}
            </p>
            <div className="flex items-center gap-1">
              {progress.state === 'paused' || progress.state === 'failed' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void finish(upload, upload.resume()).catch((caught: unknown) =>
                      setError(String(caught)),
                    )
                  }
                >
                  <Play aria-hidden />
                  Resume
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => upload.pause()}>
                  <Pause aria-hidden />
                  Pause
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void upload.cancel().finally(() => {
                    setUpload(null);
                    setProgress(null);
                  });
                }}
              >
                <X aria-hidden />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          Upload new version
        </Button>
      )}
      {error === null ? null : (
        <p role="alert" className="text-caption text-destructive font-sans">
          {error}
        </p>
      )}
    </div>
  );
}
