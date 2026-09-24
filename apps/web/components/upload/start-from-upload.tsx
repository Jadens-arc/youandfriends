'use client';

import { createProjectSchema } from '@youandfriends/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@youandfriends/ui';
import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { AUDIO_ACCEPT } from '@/components/song/versions/upload-version';
import { postJson } from '@/lib/api/client';
import { projectHref } from '@/lib/songs/routes';
import { uploadQueue, type UploadQueue } from '@/lib/upload/store';

/** "Headlights (final) v2.wav" → "Headlights (final) v2". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^./]{1,5}$/, '').trim();
  return (base === '' ? name : base).slice(0, 200);
}

/**
 * The library's first-run call to action (task `055`, filling task `041`'s slot): pick one or
 * more mixes, name the project they belong to, and each file becomes a song whose first version
 * it is. The uploads continue in the tray while the new project opens.
 */
export function StartFromUpload({ queue = uploadQueue() }: { readonly queue?: UploadQueue }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [files, setFiles] = React.useState<File[] | null>(null);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (files === null) return;
    const parsed = createProjectSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Give the project a name.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { id: projectId } = await postJson<{ id: string }>('/api/projects', { name });
      for (const file of files) {
        const title = titleFromFileName(file.name);
        const { id: songId } = await postJson<{ id: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/songs`,
          { title },
        );
        queue.add([file], { type: 'mix', songId, label: `${title} (first version)` });
      }
      setFiles(null);
      router.push(projectHref(projectId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={AUDIO_ACCEPT}
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
      <Button onClick={() => input.current?.click()}>
        <Upload aria-hidden />
        Upload your first song
      </Button>
      {files === null ? null : (
        <Dialog open onOpenChange={(open) => (open || pending ? undefined : setFiles(null))}>
          <DialogContent>
            <form onSubmit={start} className="flex flex-col gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>Name the project</DialogTitle>
                <DialogDescription>
                  {files.length === 1
                    ? `“${titleFromFileName(files[0]?.name ?? '')}” will become its first song.`
                    : `These ${files.length} files will each become a song in it.`}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="first-project-name"
                  className="text-caption text-muted-foreground font-sans"
                >
                  Project name
                </label>
                <Input
                  id="first-project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  maxLength={200}
                  aria-describedby={error === null ? undefined : 'first-project-error'}
                />
              </div>
              {error === null ? null : (
                <p
                  id="first-project-error"
                  role="alert"
                  className="text-caption text-destructive font-sans"
                >
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setFiles(null)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  Start uploading
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
