'use client';

import {
  GRANT_SCOPES,
  INVITABLE_ROLES,
  type GrantScope,
  type InvitableRole,
} from '@youandfriends/contracts';
import { Button, Checkbox, Input, Label, cn } from '@youandfriends/ui';
import { useActionState, useState } from 'react';

export type InviteState =
  | { readonly status: 'idle' }
  | { readonly status: 'sent'; readonly link: string; readonly email: string }
  | { readonly status: 'error'; readonly message: string };

export type InviteAction = (state: InviteState, formData: FormData) => Promise<InviteState>;

const SCOPE_LABEL: Record<GrantScope, string> = {
  folder: 'Folder',
  project: 'Project',
  song: 'Song',
};
const ROLE_LABEL: Record<InvitableRole, string> = {
  viewer: 'Viewer',
  commenter: 'Commenter',
  editor: 'Editor',
};

const SELECT_CLASS = cn(
  'border-border bg-card text-body text-foreground flex h-9 w-full rounded border px-3 font-sans',
);

/**
 * Invite a collaborator by email, at a scope and role (task `032`).
 *
 * The scope picker is a raw id, not a browse-and-pick control — there is no library browser to
 * pick from yet (that arrives task `040` onward). Copying an id from its own page is the
 * honest limitation until then, named in the help text rather than hidden behind a control that
 * pretends to be more than a text field.
 *
 * The token is shown exactly once, the same way a share link or a presigned upload URL is
 * (`docs/THREAT_MODEL.md` T3) — this component is what "shown once" looks like: a copyable
 * field that exists only in this render, gone the moment the form is used again or the page
 * reloads.
 */
export function InviteForm({ action }: { action: InviteAction }) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' });
  const [copied, setCopied] = useState(false);

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form
      action={(formData) => {
        setCopied(false);
        return formAction(formData);
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" name="email" type="email" required autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select id="invite-role" name="role" defaultValue="viewer" className={SELECT_CLASS}>
            {INVITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-scope-type">Scope</Label>
          <select
            id="invite-scope-type"
            name="scopeType"
            defaultValue="song"
            className={SELECT_CLASS}
          >
            {GRANT_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {SCOPE_LABEL[scope]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-scope-id">Scope id</Label>
          <Input
            id="invite-scope-id"
            name="scopeId"
            required
            autoComplete="off"
            aria-describedby="invite-scope-id-help"
          />
        </div>
      </div>
      <p id="invite-scope-id-help" className="text-caption text-muted-foreground -mt-2 font-sans">
        The folder, project, or song&rsquo;s own id. Copy it from its page until a picker exists.
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox id="invite-can-download" name="canDownload" value="on" />
          <Label htmlFor="invite-can-download">Can download originals</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="invite-can-invite" name="canInvite" value="on" />
          <Label htmlFor="invite-can-invite">Can invite others here</Label>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invitation'}
        </Button>
      </div>

      <p
        id="invite-status"
        role="status"
        aria-live="polite"
        className="text-caption min-h-5 font-sans"
      >
        {state.status === 'error' ? (
          <span className="text-destructive">{state.message}</span>
        ) : null}
        {state.status === 'sent' ? (
          <span className="text-olive-text">Invitation sent to {state.email}.</span>
        ) : null}
      </p>

      {state.status === 'sent' ? (
        <div className="border-border bg-muted flex flex-col gap-2 rounded-md border p-3">
          <p className="text-body text-foreground font-sans">
            This link works once — share it with {state.email}:
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={state.link}
              aria-label="Invitation link"
              onFocus={(event) => event.currentTarget.select()}
              className="sm:flex-1"
            />
            <Button type="button" variant="secondary" onClick={() => copyLink(state.link)}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
