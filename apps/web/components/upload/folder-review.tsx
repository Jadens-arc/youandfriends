'use client';

import { CLIENT_ZIP_MAX_BYTES, CLIENT_ZIP_MAX_FILES } from '@youandfriends/contracts';
import { Badge, Button, cn } from '@youandfriends/ui';
import { CircleSlash, FileCheck2, FileX2 } from 'lucide-react';
import * as React from 'react';

import type { FolderReview as FolderReviewData, ReviewedFile } from '@/lib/upload/manifest';
import { formatBytes } from '@/lib/songs/format';

const STATUS = {
  included: { label: 'Included', icon: FileCheck2, variant: 'current' },
  ignored: { label: 'Ignored', icon: CircleSlash, variant: 'neutral' },
  excluded: { label: 'Can’t include', icon: FileX2, variant: 'problem' },
} as const;

function FileLine({ file }: { readonly file: ReviewedFile }) {
  const status = STATUS[file.status];
  const Icon = status.icon;
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground font-mono text-[0.8125rem] break-all">
          {file.path ?? file.source.relativePath}
        </p>
        {file.reason === null ? null : (
          <p className="text-caption text-muted-foreground font-sans">{file.reason}</p>
        )}
      </div>
      <span className="text-caption text-muted-foreground tabular shrink-0 font-sans">
        {formatBytes(file.source.file.size)}
      </span>
      <Badge variant={status.variant} className="shrink-0">
        {status.label}
      </Badge>
    </li>
  );
}

function Group({
  title,
  files,
  defaultOpen,
}: {
  readonly title: string;
  readonly files: readonly ReviewedFile[];
  readonly defaultOpen: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <details open={defaultOpen} className="border-border bg-card rounded-md border">
      <summary className="text-body text-foreground cursor-pointer px-3 py-2 font-sans font-medium">
        {title} <span className="text-muted-foreground tabular">({files.length})</span>
      </summary>
      <ul className="divide-border-subtle border-border-subtle max-h-72 divide-y overflow-auto border-t">
        {files.map((file) => (
          <FileLine key={`${file.status}:${file.source.relativePath}`} file={file} />
        ))}
      </ul>
    </details>
  );
}

/**
 * The pre-upload review (task `054`): what will be sent, what will not, and why — before a byte
 * leaves the machine. Silently skipping a file is how someone discovers at the worst moment that
 * their project is incomplete; every left-out file here carries its reason in words.
 *
 * Above the browser ZIP ceiling the upload is not offered at all: the review says so and points
 * to the Mac app, rather than starting something the tab cannot finish.
 */
export function FolderReview({
  review,
  onConfirm,
  onCancel,
  busy = false,
}: {
  readonly review: FolderReviewData;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
}) {
  const included = review.files.filter((file) => file.status === 'included');
  const ignored = review.files.filter((file) => file.status === 'ignored');
  const excluded = review.files.filter((file) => file.status === 'excluded');

  return (
    <section aria-labelledby="folder-review-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="folder-review-heading" className="text-heading text-foreground font-serif">
          Upload “{review.name}”
        </h2>
        <p className="text-body text-muted-foreground font-sans">
          {included.length} {included.length === 1 ? 'file' : 'files'},{' '}
          {formatBytes(review.includedBytes)}, will be zipped and kept as one snapshot in Project
          Files.
          {ignored.length + excluded.length > 0
            ? ` ${ignored.length + excluded.length} will be left out — each with its reason below.`
            : ''}
        </p>
      </div>

      {!review.zipInBrowser && included.length > 0 ? (
        <p
          role="note"
          className={cn(
            'border-ochre-text/30 bg-ochre/10 text-foreground rounded-md border p-3 font-sans',
          )}
        >
          This folder is larger than the browser can zip reliably (
          {formatBytes(CLIENT_ZIP_MAX_BYTES)} or {CLIENT_ZIP_MAX_FILES.toLocaleString('en')} files).
          Use the You &amp; Friends Mac app to sync it instead — it zips on your Mac and resumes if
          the connection drops.
        </p>
      ) : null}
      {included.length === 0 ? (
        <p role="note" className="text-body text-foreground font-sans">
          Nothing in this folder can be uploaded.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Group title="Left out" files={[...excluded, ...ignored]} defaultOpen />
        <Group
          title="Included"
          files={included}
          defaultOpen={excluded.length + ignored.length === 0}
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={onConfirm} disabled={!review.zipInBrowser || busy}>
          Upload folder
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
