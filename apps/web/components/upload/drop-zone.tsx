'use client';

import { Button, cn } from '@youandfriends/ui';
import { Upload } from 'lucide-react';
import * as React from 'react';

import { useRegisterUploadSurface } from '@/lib/upload/current-surface';

import { UploadDialog, type UploadSurface } from './upload-dialog';

function hasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

/**
 * A surface files can be dropped on (task `055`) — a song, a project — with the destination said
 * in words on the overlay, so a drop never lands somewhere unexpected. Rendered only for people
 * who may upload there; the server re-checks every step regardless.
 *
 * Dropping is a pointer-only gesture, so the same dialog is always reachable from the
 * {@link UploadFilesButton} as well.
 */
export function DropZone({
  surface,
  children,
  className,
}: {
  readonly surface: UploadSurface;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  const [over, setOver] = React.useState(false);
  const [files, setFiles] = React.useState<File[] | null>(null);
  const depth = React.useRef(0);
  useRegisterUploadSurface(surface);

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length > 0) setFiles(dropped);
      }}
    >
      {children}
      {over ? (
        <div
          aria-hidden
          className="border-primary bg-background/85 pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed"
        >
          <p className="text-heading text-foreground font-serif">
            Drop to upload to {surface.name}
          </p>
        </div>
      ) : null}
      {files === null ? null : (
        <UploadDialog surface={surface} files={files} onClose={() => setFiles(null)} />
      )}
    </div>
  );
}

/** The keyboard path to the same dialog: a real file input behind a button. */
export function UploadFilesButton({ surface }: { readonly surface: UploadSurface }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [files, setFiles] = React.useState<File[] | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (picked.length > 0) setFiles(picked);
        }}
      />
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
        <Upload aria-hidden />
        Upload files
      </Button>
      {files === null ? null : (
        <UploadDialog surface={surface} files={files} onClose={() => setFiles(null)} />
      )}
    </>
  );
}
