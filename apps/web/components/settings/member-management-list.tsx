'use client';

import { ROLES, type Role } from '@youandfriends/contracts';
import { Badge, Button, cn } from '@youandfriends/ui';
import { useActionState } from 'react';

import type { ManagedMember } from '@/lib/workspace/settings';

export type MemberActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'ok' }
  | { readonly status: 'error'; readonly message: string };

export type MemberAction = (
  state: MemberActionState,
  formData: FormData,
) => Promise<MemberActionState>;

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

const SELECT_CLASS = cn(
  'border-border bg-card text-caption text-foreground flex h-8 rounded border px-2 font-sans',
);

/**
 * The owner-only management surface: every member, with a role-change control and a remove
 * button, plus the scope-grant count a scope-limited collaborator (`role: null`) shows in
 * place of a role it does not have (task `032`).
 *
 * Unlike `MemberList` (the read-only display beside workspace settings), this component's
 * controls always submit — there is no client-side check standing in for the server action's
 * own authorization, which is the actual boundary (`changeMemberRole`/`removeMember`,
 * `lib/workspace/members.ts`). Hiding a button here would be a courtesy, not a control.
 */
export function MemberManagementList({
  members,
  currentUserId,
  changeRoleAction,
  removeAction,
}: {
  members: readonly ManagedMember[];
  currentUserId: string;
  changeRoleAction: MemberAction;
  removeAction: MemberAction;
}) {
  if (members.length === 0) {
    return <p className="text-body text-muted-foreground font-sans">No members yet.</p>;
  }

  return (
    <ul className="border-border divide-border bg-card divide-y rounded-md border">
      {members.map((member) => (
        <MemberRow
          key={member.userId}
          member={member}
          isSelf={member.userId === currentUserId}
          changeRoleAction={changeRoleAction}
          removeAction={removeAction}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  member,
  isSelf,
  changeRoleAction,
  removeAction,
}: {
  member: ManagedMember;
  isSelf: boolean;
  changeRoleAction: MemberAction;
  removeAction: MemberAction;
}) {
  const [roleState, roleFormAction, rolePending] = useActionState(changeRoleAction, {
    status: 'idle',
  });
  const [removeState, removeFormAction, removePending] = useActionState(removeAction, {
    status: 'idle',
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body text-foreground truncate font-sans">
            {member.displayName}
            {isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
          </p>
          <p className="text-caption text-muted-foreground truncate font-sans">{member.email}</p>
          {member.role === null ? (
            <Badge variant="neutral" className="mt-1">
              {member.grantCount === 1 ? '1 scope' : `${member.grantCount} scopes`}
            </Badge>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {member.role === null ? null : (
            <form action={roleFormAction} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={member.userId} />
              <label className="sr-only" htmlFor={`role-${member.userId}`}>
                Role for {member.displayName}
              </label>
              <select
                id={`role-${member.userId}`}
                name="role"
                defaultValue={member.role}
                disabled={rolePending}
                className={SELECT_CLASS}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
            </form>
          )}
          <form action={removeFormAction}>
            <input type="hidden" name="userId" value={member.userId} />
            <Button type="submit" variant="ghost" size="sm" disabled={removePending}>
              {isSelf ? 'Leave' : 'Remove'}
            </Button>
          </form>
        </div>
      </div>

      {roleState.status === 'error' || removeState.status === 'error' ? (
        <p role="status" aria-live="polite" className="text-caption text-destructive font-sans">
          {roleState.status === 'error' ? roleState.message : null}
          {removeState.status === 'error' ? removeState.message : null}
        </p>
      ) : null}
    </li>
  );
}
