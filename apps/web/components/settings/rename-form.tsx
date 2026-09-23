'use client';

import { Button, Input, Label } from '@youandfriends/ui';
import { useActionState } from 'react';

export type RenameState =
  | { readonly status: 'idle' }
  | { readonly status: 'saved'; readonly name: string }
  | { readonly status: 'error'; readonly message: string };

export type RenameAction = (state: RenameState, formData: FormData) => Promise<RenameState>;

/**
 * Renaming the workspace.
 *
 * Shown only to someone `authz` says may rename, and the action checks again — rendering a form
 * is not a permission boundary. The outcome is announced through a live region so a screen
 * reader hears "Saved" or the reason it was not, rather than a silent re-render.
 */
export function RenameForm({ currentName, action }: { currentName: string; action: RenameAction }) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' });

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="workspace-name">Name</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="workspace-name"
          name="name"
          defaultValue={currentName}
          required
          maxLength={80}
          autoComplete="off"
          aria-describedby="workspace-name-status"
          aria-invalid={state.status === 'error' ? true : undefined}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save name'}
        </Button>
      </div>
      <p
        id="workspace-name-status"
        role="status"
        aria-live="polite"
        className="text-caption min-h-5 font-sans"
      >
        {state.status === 'saved' ? <span className="text-olive-text">Saved.</span> : null}
        {state.status === 'error' ? (
          <span className="text-destructive">{state.message}</span>
        ) : null}
      </p>
    </form>
  );
}
