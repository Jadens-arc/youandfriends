'use client';

import type { UploadableKind } from '@youandfriends/contracts';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  focusRing,
} from '@youandfriends/ui';
import * as React from 'react';

import { formatBytes } from '@/lib/songs/format';
import { uploadQueue, type UploadDestination, type UploadQueue } from '@/lib/upload/store';

/** Where a drop or a picker is aimed: a fixed surface, or a choice among writable ones. */
export type UploadSurface =
  | { readonly type: 'song'; readonly id: string; readonly name: string }
  | { readonly type: 'project'; readonly id: string; readonly name: string };

export type FileChoice = UploadableKind | 'mix';

export const CHOICE_LABELS: Readonly<Record<FileChoice, string>> = {
  mix: 'New mix version',
  master: 'Master',
  stem: 'Stem',
  sample: 'Sample',
  project_file: 'Project file',
  artwork: 'Artwork',
};

export function choicesFor(surface: UploadSurface): readonly FileChoice[] {
  return surface.type === 'song'
    ? ['mix', 'master', 'stem', 'sample', 'project_file']
    : ['project_file', 'artwork'];
}

function isAudio(file: File): boolean {
  return (
    file.type.startsWith('audio/') || /\.(wav|aiff?|flac|mp3|m4a|aac|ogg|opus)$/i.test(file.name)
  );
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|tiff?)$/i.test(file.name);
}

/**
 * A sensible first guess the person can change: on a song, one audio file is probably a new mix
 * and several are probably stems; on a project, an image is probably artwork. Everything else is
 * a project file — never a Logic section or an MPC section (`docs/DESIGN.md` §2).
 */
export function guessChoice(file: File, surface: UploadSurface, audioCount: number): FileChoice {
  if (surface.type === 'song') {
    if (isAudio(file)) return audioCount === 1 ? 'mix' : 'stem';
    return 'project_file';
  }
  return isImage(file) ? 'artwork' : 'project_file';
}

export interface QuotaInfo {
  readonly quota: { readonly usedBytes: number; readonly quotaBytes: number } | null;
  readonly maxObjectBytes: number;
}

/** The warning to show before anything is sent, or `null`. `block` means it cannot fit at all. */
export function quotaWarning(
  info: QuotaInfo | null,
  totalBytes: number,
): { readonly message: string; readonly block: boolean } | null {
  if (info?.quota == null) return null;
  const { usedBytes, quotaBytes } = info.quota;
  const left = Math.max(0, quotaBytes - usedBytes);
  if (totalBytes > left) {
    return {
      block: true,
      message: `This workspace has ${formatBytes(left)} left, and these files need ${formatBytes(totalBytes)}. Free up space or choose fewer files.`,
    };
  }
  const after = (usedBytes + totalBytes) / quotaBytes;
  if (after >= 0.9) {
    return {
      block: false,
      message: `After this upload the workspace will be ${Math.round(after * 100)}% full.`,
    };
  }
  return null;
}

function destinationFor(surface: UploadSurface, choice: FileChoice): UploadDestination {
  if (choice === 'mix') {
    return { type: 'mix', songId: surface.id, label: `${surface.name} (new version)` };
  }
  return {
    type: 'asset',
    owner: surface.type === 'song' ? { songId: surface.id } : { projectId: surface.id },
    kind: choice,
    label: `${surface.name} · ${CHOICE_LABELS[choice]}`,
  };
}

/**
 * Choosing what each dropped or picked file is (task `055`), with the destination named at the
 * top so there is no doubt where it is going, and the quota checked before a byte is sent.
 */
export function UploadDialog({
  surface,
  files,
  onClose,
  queue = uploadQueue(),
  loadQuota = defaultLoadQuota,
}: {
  readonly surface: UploadSurface;
  readonly files: readonly File[];
  readonly onClose: () => void;
  readonly queue?: UploadQueue;
  readonly loadQuota?: () => Promise<QuotaInfo | null>;
}) {
  const audioCount = files.filter(isAudio).length;
  const [choices, setChoices] = React.useState<FileChoice[]>(() =>
    files.map((file) => guessChoice(file, surface, audioCount)),
  );
  const [quota, setQuota] = React.useState<QuotaInfo | null>(null);

  React.useEffect(() => {
    let live = true;
    void loadQuota().then((info) => {
      if (live) setQuota(info);
    });
    return () => {
      live = false;
    };
  }, [loadQuota]);

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const warning = quotaWarning(quota, total);
  const tooLarge = quota === null ? [] : files.filter((file) => file.size > quota.maxObjectBytes);
  const options = choicesFor(surface);

  function send() {
    files.forEach((file, index) => {
      const choice = choices[index] ?? options[0] ?? 'project_file';
      queue.add([file], destinationFor(surface, choice));
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload to {surface.name}</DialogTitle>
          <DialogDescription>
            {files.length} {files.length === 1 ? 'file' : 'files'}, {formatBytes(total)}. Choose
            what each one is.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-border-subtle border-border max-h-80 divide-y overflow-auto rounded-md border">
          {files.map((file, index) => {
            const id = `upload-kind-${index}`;
            return (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={id}
                    className="text-body text-foreground block truncate font-sans"
                  >
                    {file.name}
                  </label>
                  <span className="text-caption text-muted-foreground font-sans">
                    {formatBytes(file.size)}
                    {tooLarge.includes(file) ? ' · larger than the per-file limit' : ''}
                  </span>
                </div>
                <select
                  id={id}
                  value={choices[index]}
                  onChange={(event) => {
                    const next = [...choices];
                    next[index] = event.target.value as FileChoice;
                    setChoices(next);
                  }}
                  className={cn(
                    'border-border bg-card text-body text-foreground h-9 rounded-md border px-2 font-sans',
                    focusRing,
                  )}
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {CHOICE_LABELS[option]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
        {warning === null ? null : (
          <p
            role={warning.block ? 'alert' : 'note'}
            className={cn(
              'text-caption font-sans',
              warning.block ? 'text-destructive' : 'text-foreground',
            )}
          >
            {warning.message}
          </p>
        )}
        {tooLarge.length > 0 ? (
          <p role="alert" className="text-caption text-destructive font-sans">
            {tooLarge.length === 1 ? 'One file is' : `${tooLarge.length} files are`} larger than{' '}
            {formatBytes(quota?.maxObjectBytes ?? 0)}, the most a single file can be.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} disabled={warning?.block === true || tooLarge.length > 0}>
            Upload {files.length === 1 ? 'file' : `${files.length} files`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function defaultLoadQuota(): Promise<QuotaInfo | null> {
  try {
    const response = await fetch('/api/uploads/quota');
    return response.ok ? ((await response.json()) as QuotaInfo) : null;
  } catch {
    // Unknown is not "fine": the server still refuses an upload that does not fit.
    return null;
  }
}
