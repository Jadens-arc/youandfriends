'use client';

import { normalizeTags, tagSchema, toFolderPath } from '@youandfriends/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@youandfriends/ui';
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { postJson } from '@/lib/api/client';
import type { SongFile } from '@/lib/songs/workspace';

export type FileActionMode = 'rename' | 'move' | 'tags' | 'trash';

/** `/Sessions/2026/` → `Sessions/2026`, the form a person types. */
export function displayFolder(folderPath: string): string {
  return folderPath.replace(/^\/|\/$/g, '');
}

/**
 * One Project Files action's dialog. Separate from the menu that opens it so the form — the part
 * with the rules — is exercised directly; the menu itself is covered in a real browser (task
 * `016`), where Radix menus behave as they do for people.
 */
export function FileActionDialog({
  file,
  mode,
  folders,
  knownTags,
  onClose,
}: {
  readonly file: SongFile;
  readonly mode: FileActionMode;
  readonly folders: readonly string[];
  readonly knownTags: readonly string[];
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(() =>
    mode === 'rename'
      ? file.name
      : mode === 'move'
        ? displayFolder(file.folderPath)
        : mode === 'tags'
          ? file.tags.join(', ')
          : '',
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const inputId = React.useId();
  const listId = React.useId();

  function validate():
    { ok: true; body?: Record<string, unknown> } | { ok: false; message: string } {
    switch (mode) {
      case 'rename':
        return value.trim() === ''
          ? { ok: false, message: 'Give the file a name.' }
          : { ok: true, body: { name: value } };
      case 'move':
        return toFolderPath(value) === null
          ? { ok: false, message: 'That folder name uses characters that can’t be stored yet.' }
          : { ok: true, body: { folder: value } };
      case 'tags': {
        const tags = normalizeTags(value.split(','));
        const bad = tags.map((tag) => tagSchema.safeParse(tag)).find((result) => !result.success);
        return bad !== undefined && !bad.success
          ? { ok: false, message: bad.error.issues[0]?.message ?? 'Check the tags.' }
          : { ok: true, body: { tags } };
      }
      default:
        return { ok: true };
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = validate();
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setPending(true);
    try {
      const path = `/api/assets/${encodeURIComponent(file.id)}`;
      if (mode === 'trash') await postJson(path, undefined, 'DELETE');
      else await postJson(path, checked.body, 'PATCH');
      onClose();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setPending(false);
    }
  }

  const titles: Record<FileActionMode, string> = {
    rename: `Rename ${file.name}`,
    move: `Move ${file.name}`,
    tags: `Tags for ${file.name}`,
    trash: `Move ${file.name} to the trash?`,
  };

  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{titles[mode]}</DialogTitle>
            <DialogDescription>
              {mode === 'trash'
                ? 'It stays in the trash for the recovery window and can be restored until then. Its versions go with it.'
                : mode === 'move'
                  ? 'Type a folder, such as “Sessions/2026”. Leave it empty for the top of Project Files.'
                  : mode === 'tags'
                    ? 'Separate tags with commas. Tags are shared across the workspace.'
                    : 'The file’s bytes are never changed — only what it is called.'}
            </DialogDescription>
          </DialogHeader>
          {mode === 'trash' ? null : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={inputId} className="text-caption text-muted-foreground font-sans">
                {mode === 'rename' ? 'Name' : mode === 'move' ? 'Folder' : 'Tags'}
              </label>
              <Input
                id={inputId}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoFocus
                list={mode === 'rename' ? undefined : listId}
                aria-describedby={error === null ? undefined : `${inputId}-error`}
              />
              {mode === 'rename' ? null : (
                <datalist id={listId}>
                  {(mode === 'move' ? folders.map(displayFolder) : knownTags).map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              )}
            </div>
          )}
          {error === null ? null : (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="text-caption text-destructive font-sans"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === 'trash' ? 'destructive' : 'primary'}
              disabled={pending}
            >
              {mode === 'trash' ? 'Move to trash' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rename, move to a folder, tag, and trash one Project Files entry (task `057`). Offered only to
 * people who may edit; the server re-checks each. Moving to a folder that does not exist yet
 * creates it — folders here are the person's own structure, made by filing something in them.
 */
export function FileActions({
  file,
  folders,
  knownTags,
}: {
  readonly file: SongFile;
  /** Folders already in use, offered as suggestions. */
  readonly folders: readonly string[];
  readonly knownTags: readonly string[];
}) {
  const [mode, setMode] = React.useState<FileActionMode | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${file.name}`}
            className="size-9"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode('rename')}>Rename…</DropdownMenuItem>
          {file.kind === 'project_file' ? (
            <DropdownMenuItem onSelect={() => setMode('move')}>Move to folder…</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setMode('tags')}>Tags…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode('trash')}>Move to trash…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === null ? null : (
        <FileActionDialog
          file={file}
          mode={mode}
          folders={folders}
          knownTags={knownTags}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
