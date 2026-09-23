import { Badge } from '@youandfriends/ui';

import type { VisibleMember } from '@/lib/workspace/settings';

/** A label and a badge tone per role. Display only — nothing here decides access. */
const ROLE_DISPLAY: Readonly<
  Record<Exclude<VisibleMember['role'], null>, { label: string; tone: 'current' | 'neutral' }>
> = {
  owner: { label: 'Owner', tone: 'current' },
  editor: { label: 'Editor', tone: 'neutral' },
  commenter: { label: 'Commenter', tone: 'neutral' },
  viewer: { label: 'Viewer', tone: 'neutral' },
};

/**
 * A `null` role is a scope-limited collaborator (task `032`): someone invited to a specific
 * folder, project, or song rather than the whole workspace, so there is no workspace-wide role
 * to name. `roleDisplayOf` is where that distinction becomes a word instead of a lookup crash.
 */
function roleDisplayOf(role: VisibleMember['role']): {
  label: string;
  tone: 'current' | 'neutral';
} {
  return role === null ? { label: 'Collaborator', tone: 'neutral' } : ROLE_DISPLAY[role];
}

/**
 * Who is in the workspace, and as what.
 *
 * Roles are shown as words, never as a colour — the badge is decoration on a label that already
 * says everything (docs/DESIGN.md §12). Addresses appear only when the caller supplied them,
 * which `readWorkspaceSettings` does only for someone who manages members.
 */
export function MemberList({ members }: { members: readonly VisibleMember[] }) {
  if (members.length === 0) {
    return <p className="text-body text-muted-foreground font-sans">No members yet.</p>;
  }

  return (
    <ul className="border-border divide-border bg-card divide-y rounded-md border">
      {members.map((member) => (
        <li key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-body text-foreground truncate font-sans">{member.displayName}</p>
            {member.email === null ? null : (
              <p className="text-caption text-muted-foreground truncate font-sans">
                {member.email}
              </p>
            )}
          </div>
          <Badge variant={roleDisplayOf(member.role).tone}>
            {roleDisplayOf(member.role).label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
