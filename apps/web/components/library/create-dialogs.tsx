'use client';

import { createProjectSchema, createSongSchema } from '@youandfriends/contracts';
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
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { postJson } from '@/lib/api/client';
import { projectHref, songHref } from '@/lib/songs/routes';

interface Field {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
}

/**
 * A small create form in a dialog (task `046`). Validated on submit with the same Zod schema the
 * route uses, so the message a person sees for an empty name is the message the server would
 * have sent; then posted, and on success the new thing is opened.
 */
function CreateDialog({
  title,
  description,
  fields,
  schema,
  submitLabel,
  onCreate,
  onClose,
}: {
  readonly title: string;
  readonly description: string;
  readonly fields: readonly Field[];
  readonly schema: {
    safeParse(value: unknown): { success: boolean; error?: { issues: { message: string }[] } };
  };
  readonly submitLabel: string;
  readonly onCreate: (values: Record<string, string>) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, ''])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error?.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCreate(values);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {fields.map((field, index) => (
            <div key={field.name} className="flex flex-col gap-1.5">
              <label
                htmlFor={`create-${field.name}`}
                className="text-caption text-muted-foreground font-sans"
              >
                {field.label}
                {field.required ? null : <span className="italic"> (optional)</span>}
              </label>
              <Input
                id={`create-${field.name}`}
                value={values[field.name] ?? ''}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                autoFocus={index === 0}
                maxLength={200}
                aria-invalid={error !== null && index === 0}
                aria-describedby={error !== null ? 'create-error' : undefined}
              />
            </div>
          ))}
          {error === null ? null : (
            <p id="create-error" role="alert" className="text-caption text-destructive font-sans">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "New project", filed in the folder open on the shelf, or at the root. */
export function NewProjectButton({ folderId }: { readonly folderId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New project
      </Button>
      {open ? (
        <CreateDialog
          title="New project"
          description="A project holds songs, their versions, lyrics, and files."
          fields={[
            { name: 'name', label: 'Project name', required: true },
            { name: 'artist', label: 'Artist', required: false },
          ]}
          schema={createProjectSchema}
          submitLabel="Create project"
          onClose={() => setOpen(false)}
          onCreate={async (values) => {
            const { id } = await postJson<{ id: string }>('/api/projects', {
              name: values.name ?? '',
              artist: values.artist ?? '',
              folderId,
            });
            router.push(projectHref(id));
          }}
        />
      ) : null}
    </>
  );
}

/** "New song", inside a project. */
export function NewSongButton({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New song
      </Button>
      {open ? (
        <CreateDialog
          title="New song"
          description="Start a song here. Its first uploaded mix becomes its current version."
          fields={[{ name: 'title', label: 'Song title', required: true }]}
          schema={createSongSchema}
          submitLabel="Create song"
          onClose={() => setOpen(false)}
          onCreate={async (values) => {
            const { id } = await postJson<{ id: string }>(
              `/api/projects/${encodeURIComponent(projectId)}/songs`,
              { title: values.title ?? '' },
            );
            router.push(songHref(id));
          }}
        />
      ) : null}
    </>
  );
}
