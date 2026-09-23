'use client';

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
import * as React from 'react';

export interface NameDialogProps {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly initialName?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (name: string) => Promise<{ status: 'ok' | 'error'; message?: string }>;
}

/**
 * A folder's name, asked once — shared by "New folder" and "Rename" (task `040`).
 *
 * One dialog rather than two nearly-identical ones: both ask for exactly one thing, validate
 * it the same way server-side, and differ only in the verb on the button.
 *
 * Conditionally rendered by the caller rather than always mounted with an `open` boolean — and
 * given a fresh `key` for each distinct thing it is naming (`library-browser.tsx`) — so `name`
 * and `error` can be seeded once, from the first render, with no effect to reset them: opening
 * this for a different folder, or reopening it after a failed attempt, mounts a clean instance
 * instead of reaching back into one that remembers the last attempt.
 */
export function NameDialog({
  title,
  description,
  confirmLabel,
  initialName = '',
  onOpenChange,
  onSubmit,
}: NameDialogProps) {
  const [name, setName] = React.useState(initialName);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await onSubmit(name);
    setPending(false);
    if (result.status === 'ok') onOpenChange(false);
    else setError(result.message ?? 'That name did not work.');
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="folder-name" className="text-caption text-muted-foreground font-sans">
              Folder name
            </label>
            <Input
              id="folder-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={120}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? 'folder-name-error' : undefined}
            />
            {error !== null ? (
              <p
                id="folder-name-error"
                role="alert"
                className="text-caption text-destructive font-sans"
              >
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || name.trim().length === 0}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
