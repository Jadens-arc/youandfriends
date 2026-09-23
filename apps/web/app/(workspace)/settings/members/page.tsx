import { AppError } from '@youandfriends/contracts';
import { notFound } from 'next/navigation';

import { MemberList } from '@/components/settings/member-list';
import { currentWorkspace, workspaceRequest } from '@/lib/workspace/current';
import { readMemberManagement } from '@/lib/workspace/settings';

export const metadata = { title: 'Members · You & Friends' };

/**
 * Member management — owners only.
 *
 * The entry point for inviting, removing, and changing the role of members, which arrive in
 * task `032`. It exists now so the owner-only rule has a route to hold it: anyone else is
 * refused in `readMemberManagement`, the refusal is recorded in the workspace's audit log, and
 * they see the same "not found" as a page that does not exist.
 */
export default async function MembersPage() {
  const context = await currentWorkspace();
  if (context === null) notFound();

  const members = await readMemberManagement(workspaceRequest(context)).catch((error: unknown) => {
    if (error instanceof AppError && error.publicCode === 'not_found') notFound();
    throw error;
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Members</h1>
        <p className="text-body text-muted-foreground mt-1 font-sans">
          Inviting people and changing what they can do arrives in task 032.
        </p>
      </header>
      <MemberList members={members} />
    </div>
  );
}
